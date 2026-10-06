import {
  ChangeRequest,
  ChangeResource,
  ChangeWindow,
  isWindowOverlapping,
  REVIEW_CONSTRAINT_VERSION,
  validateChange,
  ValidationIssue,
} from './change-request.model';

export { REVIEW_CONSTRAINT_VERSION };

export interface BlackoutWindow {
  id: string;
  name: string;
  start: string;
  end: string;
  /** 空数组表示全网封网；否则只覆盖列出的资源 ID。 */
  resourceIds: string[];
  scopeLabel: string;
}

export interface CutoverTarget {
  targetResourceId: string;
  requiredCapacityUnits: number;
}

const TERMINAL_STATUSES: ReadonlyArray<ChangeRequest['status']> = ['completed', 'rolled_back'];
/** 可充当“前序变更”的状态：仍在途或已批准/待命中的都不能视作完成。 */
const PREDECESSOR_STATUSES: ReadonlyArray<ChangeRequest['status']> = [
  'submitted',
  'approved',
  'standby',
  'executing',
];

/**
 * 封网日历。封网期间只允许与封网资源无关的变更：
 * 窗口落在封网区间、且影响资源命中封网范围时直接挡住提交。
 */
export const BLACKOUT_CALENDAR: BlackoutWindow[] = [
  {
    id: 'blackout-2026-national',
    name: '国庆封网',
    start: '2026-09-30T18:00',
    end: '2026-10-08T08:00',
    resourceIds: [],
    scopeLabel: '全网资源',
  },
  {
    id: 'blackout-2026-a3-power',
    name: 'A3 机柜供电检修',
    start: '2026-10-09T01:00',
    end: '2026-10-09T05:00',
    resourceIds: ['rack-a3'],
    scopeLabel: 'A3 机柜',
  },
];

function calendarWindow(blackout: BlackoutWindow): ChangeWindow {
  return {
    start: blackout.start,
    end: blackout.end,
    observationWindowMinutes: 0,
    blackoutProtected: false,
  };
}

export function resourceById(
  changes: ChangeRequest[],
  resourceId: string,
): { resource: ChangeResource; change: ChangeRequest } | null {
  for (const change of changes) {
    const resource = change.resources.find((item) => item.id === resourceId);
    if (resource) {
      return { resource, change };
    }
  }
  return null;
}

/** 找到本变更窗口命中的封网日历项（含全网封网）。 */
export function findBlackoutForWindow(
  window: ChangeWindow,
  resources: ChangeResource[],
  blackouts: BlackoutWindow[] = BLACKOUT_CALENDAR,
): { blackout: BlackoutWindow; affected: ChangeResource[] } | null {
  for (const blackout of blackouts) {
    if (!isWindowOverlapping(window, calendarWindow(blackout))) {
      continue;
    }
    const affected = blackout.resourceIds.length
      ? resources.filter((resource) => blackout.resourceIds.includes(resource.id))
      : resources.slice();
    if (affected.length > 0) {
      return { blackout, affected };
    }
  }
  return null;
}

/** 回滚落点命中封网资源（含全网封网）时不可提交。 */
export function findRollbackLandingBlackout(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
  blackouts: BlackoutWindow[] = BLACKOUT_CALENDAR,
): { blackout: BlackoutWindow; landingIds: string[] } | null {
  const landingIds = Array.from(
    new Set(
      change.steps
        .filter((step) => step.phase === 'rollback')
        .flatMap((step) => step.landingResourceIds ?? []),
    ),
  );
  if (landingIds.length === 0) {
    return null;
  }

  for (const blackout of blackouts) {
    if (!isWindowOverlapping(change.window, calendarWindow(blackout))) {
      continue;
    }
    const hit = landingIds.filter((landingId) => {
      // 全网封网：只要落点是已知资源即命中；定向封网：落在受保护机柜即命中。
      if (blackout.resourceIds.length === 0) {
        return resourceById(allChanges, landingId) !== null;
      }
      return blackout.resourceIds.includes(landingId);
    });
    if (hit.length > 0) {
      return { blackout, landingIds: hit };
    }
  }
  return null;
}

export interface CutoverCapacityResult {
  target?: ChangeResource;
  targetLabel: string;
  required: number;
  available: number;
  insufficient: boolean;
}

/** 切换目标剩余容量必须容纳本次切换所需容量。 */
export function evaluateCutoverCapacity(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): CutoverCapacityResult | null {
  const cutover = change.cutover;
  if (!cutover || !cutover.targetResourceId) {
    return null;
  }
  const located = resourceById(allChanges, cutover.targetResourceId);
  const required = cutover.requiredCapacityUnits ?? 0;
  const target = located?.resource;
  const available =
    target && target.capacityUnits !== undefined
      ? Math.max(0, target.capacityUnits - (target.committedCapacityUnits ?? 0))
      : 0;
  return {
    target,
    targetLabel: target ? `${target.name}（${target.id}）` : cutover.targetResourceId,
    required,
    available,
    insufficient: !target || available < required,
  };
}

export interface PredecessorGate {
  predecessorId: string;
  predecessorTitle: string;
  sharedRacks: string[];
  completed: boolean;
  blocking: boolean;
}

/**
 * 共享机柜变更按依赖排列：本变更资源依赖了另一变更独占的前序资源时，
 * 前序未完成（completed）则后续停在待命。
 */
export function evaluatePredecessorGates(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): PredecessorGate[] {
  const ownResourceIds = new Set(change.resources.map((resource) => resource.id));
  const ownRackIds = new Set(
    change.resources.filter((resource) => resource.type === 'rack').map((resource) => resource.id),
  );
  const referencedIds = new Set(change.resources.flatMap((resource) => resource.dependencies));
  const gates: PredecessorGate[] = [];

  for (const candidate of allChanges) {
    if (candidate.id === change.id || !PREDECESSOR_STATUSES.includes(candidate.status)) {
      continue;
    }
    const predecessorIds = candidate.resources
      .filter((resource) => !ownResourceIds.has(resource.id) && referencedIds.has(resource.id))
      .map((resource) => resource.id);
    if (predecessorIds.length === 0) {
      continue;
    }
    const candidateRackIds = candidate.resources
      .filter((resource) => resource.type === 'rack')
      .map((resource) => resource.id);
    const sharedRacks = candidateRackIds.filter((rackId) => ownRackIds.has(rackId));
    const completed = candidate.status === 'completed';
    gates.push({
      predecessorId: candidate.id,
      predecessorTitle: candidate.title,
      sharedRacks: sharedRacks.length
        ? sharedRacks
        : candidateRackIds.length
          ? candidateRackIds.slice(0, 1)
          : [],
      completed,
      blocking: !completed,
    });
  }

  return gates;
}

/** 已批准但前序未完成的变更停在待命，保留现状不允许开始执行。 */
export function isExecutionStandby(change: ChangeRequest, allChanges: ChangeRequest[]): boolean {
  if (change.status !== 'approved' && change.status !== 'standby') {
    return false;
  }
  return evaluatePredecessorGates(change, allChanges).some((gate) => gate.blocking);
}

export type ConstraintCompletion = 'complete' | 'pending_supplement';

/** 三类约束信息是否已登记：切换目标与回滚落点齐备。 */
export function hasConstraintData(change: ChangeRequest): boolean {
  if (!change.cutover || !change.cutover.targetResourceId) {
    return false;
  }
  return change.steps
    .filter((step) => step.phase === 'rollback')
    .every((step) => (step.landingResourceIds ?? []).length > 0);
}

/**
 * 旧记录缺少三类约束的任何一类时标成“待补”，不能直接放行：
 * 缺约束版本号，或缺切换目标/回滚落点均视为待补。
 */
export function constraintCompletion(change: ChangeRequest): ConstraintCompletion {
  if (change.constraintVersion !== REVIEW_CONSTRAINT_VERSION) {
    return 'pending_supplement';
  }
  if (change.status === 'draft' || change.status === 'rejected') {
    return 'complete';
  }
  return hasConstraintData(change) ? 'complete' : 'pending_supplement';
}

/**
 * 批准时记录的窗口与依赖指纹。批准后窗口或依赖变化据此识别：
 * 未执行的会签作废并重新送审，执行中的只记录影响。
 */
export function buildReviewSnapshot(change: ChangeRequest): string {
  const dependencyEdges = change.resources
    .flatMap((resource) => resource.dependencies.map((dep) => `${resource.id}>${dep}`))
    .sort();
  return JSON.stringify({
    start: change.window.start,
    end: change.window.end,
    observation: change.window.observationWindowMinutes,
    resources: change.resources.map((resource) => resource.id).sort(),
    dependencyEdges,
  });
}

/** 补齐旧数据缺失字段，并为没有快照的在途记录补建快照。 */
export function normalizeChange(raw: ChangeRequest): ChangeRequest {
  const change: ChangeRequest = {
    ...raw,
    resources: raw.resources.map((resource) => ({ ...resource })),
    steps: raw.steps.map((step) => ({ ...step })),
  };
  if (!change.reviewSnapshot && ['approved', 'standby', 'executing'].includes(change.status)) {
    change.reviewSnapshot = buildReviewSnapshot(change);
  }
  return change;
}

/**
 * 三类约束（封网日历、依赖前序、回滚落点/切换容量）统一接入同一张审阅单。
 * 这些问题与窗口重叠无关，必须独立参与提交门禁与会签审阅。
 */
export function validateReviewConstraints(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const active = !TERMINAL_STATUSES.includes(change.status);
  const pendingSupplement = constraintCompletion(change) === 'pending_supplement';

  if (active && pendingSupplement) {
    issues.push({
      id: `${change.id}-constraint-legacy`,
      changeId: change.id,
      severity: 'blocker',
      code: 'CONSTRAINT_PENDING_SUPPLEMENT',
      title: '旧记录缺少审阅约束，待补',
      detail:
        '该记录生成于三类约束接入审阅单之前，缺少封网日历、依赖前序或回滚落点/切换容量信息，不能直接放行。',
      suggestedAction: '补齐封网核对、前序依赖、回滚落点与切换目标容量后重新送审。',
    });
  }

  // 旧记录信息不全时，只报“待补”，不再基于缺失数据推断封网/容量结论。
  if (pendingSupplement && change.status !== 'draft' && change.status !== 'rejected') {
    return issues;
  }

  const blackout = findBlackoutForWindow(change.window, change.resources);
  if (blackout) {
    issues.push({
      id: `${change.id}-blackout-${blackout.blackout.id}`,
      changeId: change.id,
      severity: 'blocker',
      code: 'BLACKOUT_CALENDAR_CONFLICT',
      title: `窗口撞上封网日历：${blackout.blackout.name}`,
      detail: `执行窗口与 ${blackout.blackout.scopeLabel} 的封网区间（${blackout.blackout.start} 至 ${blackout.blackout.end}）重叠，命中资源：${blackout.affected
        .map((resource) => resource.name)
        .join('、')}。`,
      suggestedAction: '将窗口调整到封网结束之后，或把封网资源移出本次变更范围。',
      relatedId: blackout.blackout.id,
    });
  }

  const rollbackLanding = findRollbackLandingBlackout(change, allChanges);
  if (rollbackLanding) {
    issues.push({
      id: `${change.id}-rollback-blackout-${rollbackLanding.blackout.id}`,
      changeId: change.id,
      severity: 'blocker',
      code: 'ROLLBACK_LANDING_BLACKOUT',
      title: `回滚落点位于封网资源：${rollbackLanding.blackout.name}`,
      detail: `回滚落点 ${rollbackLanding.landingIds.join('、')} 在 ${rollbackLanding.blackout.scopeLabel} 封网区间内，触发回滚时落点不可用，提交将被挡住并保留现状。`,
      suggestedAction: '更换不受封网影响的回滚落点，或把窗口移出封网区间。',
      relatedId: rollbackLanding.blackout.id,
    });
  }

  const capacity = evaluateCutoverCapacity(change, allChanges);
  if (capacity && capacity.insufficient) {
    issues.push({
      id: `${change.id}-cutover-capacity`,
      changeId: change.id,
      severity: 'blocker',
      code: 'CUTOVER_CAPACITY_INSUFFICIENT',
      title: '切换目标容量不足',
      detail: `切换目标 ${capacity.targetLabel} 剩余容量 ${capacity.available} 单元，本次切换需要 ${capacity.required} 单元。提交被挡住并保留现状。`,
      suggestedAction: '扩容切换目标、调小切换量，或更换容量充足的目标后重新提交。',
      relatedId: change.cutover?.targetResourceId,
    });
  }

  // 前序未完成不挡住送审（允许先会签），但批准后停在待命、禁止开始执行。
  evaluatePredecessorGates(change, allChanges)
    .filter((gate) => gate.blocking)
    .forEach((gate) => {
      issues.push({
        id: `${change.id}-predecessor-${gate.predecessorId}`,
        changeId: change.id,
        severity: 'info',
        code: 'PREDECESSOR_NOT_READY',
        title: `共享机柜前序 ${gate.predecessorId} 未完成，后续停在待命`,
        detail: `前序变更“${gate.predecessorTitle}”尚未执行完成${
          gate.sharedRacks.length ? `，共享机柜：${gate.sharedRacks.join('、')}` : ''
        }，本变更按依赖排列停在待命。`,
        suggestedAction: '等待前序变更执行完成后再启动；如需提前，须解除依赖并重新会签。',
        relatedId: gate.predecessorId,
      });
    });

  return issues;
}

/** 统一审阅单校验：原有窗口/依赖/回滚/责任人校验 + 三类约束。 */
export function validateFullReview(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ValidationIssue[] {
  return [...validateChange(change, allChanges), ...validateReviewConstraints(change, allChanges)];
}

/** 提交门禁阻断项；前序未完成仅提示（info），不阻止送审。 */
export function submissionBlockers(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ValidationIssue[] {
  return validateFullReview(change, allChanges).filter((issue) => issue.severity === 'blocker');
}
