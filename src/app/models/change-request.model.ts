import {
  BlackoutPeriod,
  blackoutCoversAnyResource,
  isResourceInBlackoutScope,
  isWindowInBlackout,
} from './blackout.model';

export type ChangeStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'standby'
  | 'executing'
  | 'completed'
  | 'rolled_back'
  | 'rejected';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ResourceType = 'datacenter' | 'rack' | 'network' | 'storage' | 'service';
export type ApprovalStage = 'network' | 'system' | 'security' | 'business';
export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'frozen';
export type StepPhase = 'prepare' | 'execute' | 'verify' | 'rollback';
export type IssueSeverity = 'blocker' | 'warning' | 'info';
export type ConstraintCompleteness = 'complete' | 'incomplete';

/** 资源容量水位，供切换目标容量校核使用。 */
export interface ResourceCapacity {
  totalUnits: number;
  availableUnits: number;
}

export interface ChangeResource {
  id: string;
  name: string;
  type: ResourceType;
  critical: boolean;
  dependencies: string[];
  capacity?: ResourceCapacity;
}

/** 回滚落点：回退操作实际落回的资源及其预留容量。 */
export interface RollbackLanding {
  resourceId: string;
  resourceName?: string;
  availableCapacityUnits?: number;
  note?: string;
}

/** 切换目标：执行切换时目标资源的容量需求。 */
export interface SwitchTargetCapacity {
  resourceId: string;
  resourceName?: string;
  availableUnits: number;
  requiredUnits: number;
  unitLabel: string;
}

export interface ChangeStep {
  id: string;
  phase: StepPhase;
  title: string;
  owner: string;
  durationMinutes: number;
  command: string;
  completed: boolean;
  completedAt?: string;
  /** 仅回滚步骤：回退落点资源。 */
  rollbackLanding?: RollbackLanding;
  /** 仅执行步骤：流量/负载切换目标的容量要求。 */
  targetCapacity?: SwitchTargetCapacity;
}

export interface ChangeWindow {
  start: string;
  end: string;
  observationWindowMinutes: number;
  blackoutProtected: boolean;
  /** 批准时命中的封网条目快照。 */
  blackoutCheckedAt?: string;
  blackoutKey?: string;
}

/**
 * 批准时刻的约束快照：批准后窗口或前序依赖发生变化时，
 * 未执行的会签据此作废并重新送审；执行中只记录影响。
 */
export interface ConstraintSnapshot {
  windowStart: string;
  windowEnd: string;
  /** 当时的前序变更 ID（按依赖顺序）。 */
  prerequisiteIds: string[];
  blackoutKey: string;
  approvedAt: string;
}

export interface ApprovalRecord {
  stage: ApprovalStage;
  state: ApprovalState;
  approver?: string;
  decidedAt?: string;
  comment?: string;
}

export interface DeviationRecord {
  id: string;
  recordedAt: string;
  owner: string;
  description: string;
  decision: 'continue' | 'pause' | 'rollback';
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
}

export interface ChangeRequest {
  id: string;
  title: string;
  summary: string;
  owner: string;
  onCall: string[];
  status: ChangeStatus;
  risk: RiskLevel;
  resources: ChangeResource[];
  steps: ChangeStep[];
  window: ChangeWindow;
  approvals: ApprovalRecord[];
  deviations: DeviationRecord[];
  audit: AuditRecord[];
  /**
   * 约束数据完整度：旧记录缺少封网/依赖/回滚落点约束时标为待补，
   * 不能直接放行（待补本身作为提交阻断项）。
   */
  constraintCompleteness: ConstraintCompleteness;
  /** 批准时冻结的约束快照，执行前据此识别会签失效。 */
  constraintSnapshot?: ConstraintSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationIssue {
  id: string;
  changeId: string;
  severity: IssueSeverity;
  code:
    | 'DEPENDENCY_MISSING'
    | 'WINDOW_CONFLICT'
    | 'ROLLBACK_UNEXECUTABLE'
    | 'OBSERVATION_TOO_SHORT'
    | 'OWNER_MISSING'
    | 'BLACKOUT_WINDOW'
    | 'ROLLBACK_LANDING_BLACKOUT'
    | 'TARGET_CAPACITY_INSUFFICIENT'
    | 'PREREQUISITE_WAITING'
    | 'CONSTRAINTS_INCOMPLETE';
  title: string;
  detail: string;
  suggestedAction: string;
  relatedId?: string;
}

/** 审阅单运行时上下文：封网日历来自平台配置，不是变更单的一部分。 */
export interface ReviewContext {
  blackouts: BlackoutPeriod[];
  now?: Date;
}

/** 提交会签时必须清零的阻断规则。 */
export const SUBMISSION_BLOCKER_CODES: ReadonlySet<ValidationIssue['code']> = new Set([
  'DEPENDENCY_MISSING',
  'WINDOW_CONFLICT',
  'ROLLBACK_UNEXECUTABLE',
  'OWNER_MISSING',
  'BLACKOUT_WINDOW',
  'ROLLBACK_LANDING_BLACKOUT',
  'TARGET_CAPACITY_INSUFFICIENT',
  'CONSTRAINTS_INCOMPLETE',
]);

export const APPROVAL_ORDER: ApprovalStage[] = ['network', 'system', 'security', 'business'];

export const STATUS_LABELS: Record<ChangeStatus, string> = {
  draft: '草稿',
  submitted: '待会签',
  approved: '已批准',
  standby: '待命中',
  executing: '执行中',
  completed: '已完成',
  rolled_back: '已回滚',
  rejected: '已退回',
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
};

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  datacenter: '机房',
  rack: '机柜',
  network: '网络',
  storage: '存储',
  service: '服务',
};

export const STAGE_LABELS: Record<ApprovalStage, string> = {
  network: '网络负责人',
  system: '系统负责人',
  security: '安全负责人',
  business: '业务负责人',
};

export const PHASE_LABELS: Record<StepPhase, string> = {
  prepare: '准备',
  execute: '执行',
  verify: '验证',
  rollback: '回滚',
};

export function createEmptyApprovals(): ApprovalRecord[] {
  return APPROVAL_ORDER.map((stage) => ({ stage, state: 'pending' }));
}

export function createEmptyChange(): ChangeRequest {
  const now = new Date();
  // 默认排在封网保障期（国庆至 10-08）之后，避免干净草稿默认窗口即被封网拦截。
  const start = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  return {
    id: `CHG-${Math.floor(1000 + Math.random() * 9000)}`,
    title: '',
    summary: '',
    owner: '',
    onCall: [],
    status: 'draft',
    risk: 'medium',
    resources: [],
    steps: [],
    window: {
      start: toLocalInputValue(start),
      end: toLocalInputValue(end),
      observationWindowMinutes: 30,
      blackoutProtected: false,
    },
    approvals: createEmptyApprovals(),
    deviations: [],
    audit: [],
    constraintCompleteness: 'complete',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * 规范化从 localStorage 或旧版 mock 读入的记录：
 * 旧记录缺少三类约束数据时统一标成“待补”，不能直接放行。
 */
export function normalizeLegacyChange(raw: ChangeRequest): ChangeRequest {
  if ((raw as Partial<ChangeRequest>).constraintCompleteness !== undefined) {
    return raw;
  }
  return {
    ...raw,
    constraintCompleteness: 'incomplete',
  };
}

export function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function isWindowOverlapping(left: ChangeWindow, right: ChangeWindow): boolean {
  const leftStart = new Date(left.start).getTime();
  const leftEnd = new Date(left.end).getTime();
  const rightStart = new Date(right.start).getTime();
  const rightEnd = new Date(right.end).getTime();
  return leftStart < rightEnd && rightStart < leftEnd;
}

/** 会参与窗口/冲突判定的有效状态（排除草稿、退回、已回滚和待命后续）。 */
export const ACTIVE_CHANGE_STATUSES: ChangeStatus[] = [
  'submitted',
  'approved',
  'standby',
  'executing',
  'completed',
];

const TERMINAL_CHANGE_STATUSES: ChangeStatus[] = ['completed'];

/**
 * 计算两个变更之间的共享资源。
 */
export function sharedResources(change: ChangeRequest, other: ChangeRequest): ChangeResource[] {
  return change.resources.filter((resource) =>
    other.resources.some((candidate) => candidate.id === resource.id),
  );
}

/**
 * 前序变更：
 * 1) 跨单资源依赖——本变更资源依赖于另一变更尚未完成的资源；
 * 2) 共享机柜（rack）变更——按执行窗口起点排序，先做的是前序。
 * 返回结果按依赖顺序排列（窗口起点升序，再按编号稳定排序）。
 */
export function prerequisiteChanges(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ChangeRequest[] {
  const dependencyIds = new Set(change.resources.flatMap((resource) => resource.dependencies));
  const ownResourceIds = new Set(change.resources.map((resource) => resource.id));
  const changeStart = new Date(change.window.start).getTime();

  const prerequisites = allChanges.filter((candidate) => {
    if (candidate.id === change.id || TERMINAL_CHANGE_STATUSES.includes(candidate.status)) {
      return false;
    }
    if (!ACTIVE_CHANGE_STATUSES.includes(candidate.status)) {
      return false;
    }

    // 跨单资源依赖：前序窗口必须不晚于本变更。
    const providesDependency = candidate.resources.some(
      (resource) => dependencyIds.has(resource.id) && !ownResourceIds.has(resource.id),
    );
    if (providesDependency && new Date(candidate.window.start).getTime() <= changeStart) {
      return true;
    }

    // 共享机柜变更：同一机柜上的变更按窗口起点串行排列，先做的是前序。
    const sharesRack = sharedResources(change, candidate).some(
      (resource) => resource.type === 'rack',
    );
    if (!sharesRack) {
      return false;
    }
    const candidateStart = new Date(candidate.window.start).getTime();
    return (
      candidateStart < changeStart || (candidateStart === changeStart && candidate.id < change.id)
    );
  });

  return prerequisites.sort((left, right) => {
    const byStart = new Date(left.window.start).getTime() - new Date(right.window.start).getTime();
    return byStart || left.id.localeCompare(right.id);
  });
}

/** 前序是否已全部完成（未完成时后续变更停在待命）。 */
export function unfinishedPrerequisites(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ChangeRequest[] {
  return prerequisiteChanges(change, allChanges).filter(
    (prerequisite) => prerequisite.status !== 'completed',
  );
}

/** 封网日历版本指纹：日历变化时已批准的会签作废并重新送审。 */
export function blackoutFingerprint(blackouts: BlackoutPeriod[]): string {
  return blackouts
    .map(
      (period) =>
        `${period.id}|${period.start}|${period.end}|${[...period.scopeResourceIds].sort().join(',')}`,
    )
    .sort()
    .join(';');
}

/** 生成批准时刻的约束快照。 */
export function buildConstraintSnapshot(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
  blackouts: BlackoutPeriod[],
): ConstraintSnapshot {
  return {
    windowStart: change.window.start,
    windowEnd: change.window.end,
    prerequisiteIds: prerequisiteChanges(change, allChanges).map((item) => item.id),
    blackoutKey: blackoutFingerprint(blackouts),
    approvedAt: new Date().toISOString(),
  };
}

export type ConstraintDriftKind = 'window' | 'prerequisite' | 'blackout';

export interface ConstraintDrift {
  kind: ConstraintDriftKind;
  detail: string;
}

/**
 * 对比约束快照：批准后窗口或前序依赖变化时，未执行的会签作废并重新送审。
 * skipBlackout 用于封网日历尚未加载完成时避免误判日历漂移。
 */
export function detectConstraintDrift(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
  blackouts: BlackoutPeriod[],
  options: { skipBlackout?: boolean } = {},
): ConstraintDrift[] {
  const snapshot = change.constraintSnapshot;
  if (!snapshot) {
    return [];
  }
  const drifts: ConstraintDrift[] = [];
  if (snapshot.windowStart !== change.window.start || snapshot.windowEnd !== change.window.end) {
    drifts.push({
      kind: 'window',
      detail: `执行窗口由 ${snapshot.windowStart} ~ ${snapshot.windowEnd} 调整为 ${change.window.start} ~ ${change.window.end}。`,
    });
  }
  const currentPrerequisites = prerequisiteChanges(change, allChanges).map((item) => item.id);
  const snapshotSet = new Set(snapshot.prerequisiteIds);
  const currentSet = new Set(currentPrerequisites);
  const added = currentPrerequisites.filter((id) => !snapshotSet.has(id));
  const removed = snapshot.prerequisiteIds.filter((id) => !currentSet.has(id));
  if (added.length || removed.length) {
    const parts: string[] = [];
    if (added.length) {
      parts.push(`新增前序 ${added.join('、')}`);
    }
    if (removed.length) {
      parts.push(`前序 ${removed.join('、')} 已解除`);
    }
    drifts.push({ kind: 'prerequisite', detail: parts.join('；') + '。' });
  }
  if (!options.skipBlackout) {
    const currentBlackoutKey = blackoutFingerprint(blackouts);
    if (snapshot.blackoutKey !== currentBlackoutKey) {
      drifts.push({
        kind: 'blackout',
        detail: '封网日历在批准后发生调整，需按新日历重新审阅。',
      });
    }
  }
  return drifts;
}

/** 提交会签的阻断项（待补、封网、回滚落点封网、容量不足等均在此拦截）。 */
export function getSubmissionBlockers(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
  context: ReviewContext = { blackouts: [] },
): ValidationIssue[] {
  return validateChange(change, allChanges, context).filter(
    (issue) => issue.severity === 'blocker' && SUBMISSION_BLOCKER_CODES.has(issue.code),
  );
}

export function validateChange(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
  context: ReviewContext = { blackouts: [] },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resourceMap = new Map(change.resources.map((resource) => [resource.id, resource]));
  const blackouts = context.blackouts ?? [];

  change.resources.forEach((resource) => {
    resource.dependencies
      .filter((dependencyId) => !resourceMap.has(dependencyId))
      .forEach((dependencyId) => {
        issues.push({
          id: `${change.id}-dependency-${resource.id}-${dependencyId}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'DEPENDENCY_MISSING',
          title: `缺少依赖对象 ${dependencyId}`,
          detail: `${resource.name} 依赖 ${dependencyId}，但该对象未纳入本次变更范围。`,
          suggestedAction: '补充依赖对象，或提供不在范围内的书面依据。',
          relatedId: dependencyId,
        });
      });
  });

  allChanges
    .filter(
      (candidate) =>
        candidate.id !== change.id &&
        ACTIVE_CHANGE_STATUSES.includes(candidate.status) &&
        isWindowOverlapping(change.window, candidate.window),
    )
    .forEach((candidate) => {
      const shared = sharedResources(change, candidate);
      if (shared.length > 0) {
        issues.push({
          id: `${change.id}-conflict-${candidate.id}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'WINDOW_CONFLICT',
          title: `与 ${candidate.id} 存在窗口冲突`,
          detail: `共享资源：${shared.map((resource) => resource.name).join('、')}。两项变更的执行窗口发生重叠。`,
          suggestedAction: '调整窗口、串行等待，或将冲突资源移出本次范围。',
          relatedId: candidate.id,
        });
      }
    });

  // 封网日历：窗口落入封网时段即拦截，不能送审。
  blackouts
    .filter(
      (period) =>
        isWindowInBlackout(change.window, period) &&
        blackoutCoversAnyResource(
          period,
          change.resources.map((resource) => resource.id),
        ),
    )
    .forEach((period) => {
      issues.push({
        id: `${change.id}-blackout-${period.id}`,
        changeId: change.id,
        severity: 'blocker',
        code: 'BLACKOUT_WINDOW',
        title: `执行窗口撞上封网“${period.name}”`,
        detail: `封网时段 ${period.start} 至 ${period.end} 覆盖本次变更资源，封网期间禁止生产变更。${period.reason}`,
        suggestedAction: '将窗口调整到封网时段之外，或取得封网指挥的书面豁免后再送审。',
        relatedId: period.id,
      });
    });

  // 回滚落点：落点资源处于封网范围时，提交被挡住并保留现状。
  change.steps
    .filter((step) => step.phase === 'rollback' && step.rollbackLanding)
    .forEach((step) => {
      const landing = step.rollbackLanding!;
      const hitBlackout = blackouts.find(
        (period) =>
          isWindowInBlackout(change.window, period) &&
          isResourceInBlackoutScope(period, landing.resourceId),
      );
      if (hitBlackout) {
        issues.push({
          id: `${change.id}-landing-blackout-${step.id}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'ROLLBACK_LANDING_BLACKOUT',
          title: `回滚落点“${landing.resourceName ?? landing.resourceId}”位于封网范围`,
          detail: `回滚步骤“${step.title}”的落点 ${landing.resourceId} 在封网“${hitBlackout.name}”覆盖范围内，一旦失败无法回退到现状。`,
          suggestedAction: '更换封网范围外的回滚落点，或调整窗口避开封网时段。',
          relatedId: landing.resourceId,
        });
      }
    });

  // 切换目标容量：目标可用容量不足时挡住提交，保留现状。
  change.steps
    .filter((step) => step.phase === 'execute' && step.targetCapacity)
    .forEach((step) => {
      const target = step.targetCapacity!;
      if (target.availableUnits < target.requiredUnits) {
        issues.push({
          id: `${change.id}-capacity-${step.id}`,
          changeId: change.id,
          severity: 'blocker',
          code: 'TARGET_CAPACITY_INSUFFICIENT',
          title: `切换目标“${target.resourceName ?? target.resourceId}”容量不足`,
          detail: `步骤“${step.title}”需要 ${target.requiredUnits} ${target.unitLabel}，目标仅剩 ${target.availableUnits} ${target.unitLabel}。`,
          suggestedAction: '先扩容切换目标、降低切换批次，或改选容量充足的目标后再送审。',
          relatedId: target.resourceId,
        });
      }
    });

  // 前序依赖：共享机柜变更按依赖排列，前序没完成时后续停在待命。
  const waiting = unfinishedPrerequisites(change, allChanges);
  if (waiting.length > 0 && ['approved', 'standby'].includes(change.status)) {
    issues.push({
      id: `${change.id}-prerequisite-waiting`,
      changeId: change.id,
      severity: 'warning',
      code: 'PREREQUISITE_WAITING',
      title: `前序变更未完成，后续停在待命`,
      detail: `仍需等待：${waiting
        .map((item) => `${item.id}（${STATUS_LABELS[item.status]}）`)
        .join('、')}。前序全部完成后方可执行。`,
      suggestedAction: '不要提前执行；前序完成后系统会自动解除待命。',
    });
  }

  change.steps
    .filter((step) => step.phase === 'rollback' && (!step.command.trim() || !step.owner.trim()))
    .forEach((step) => {
      issues.push({
        id: `${change.id}-rollback-${step.id}`,
        changeId: change.id,
        severity: 'blocker',
        code: 'ROLLBACK_UNEXECUTABLE',
        title: `回滚步骤“${step.title || '未命名'}”不可执行`,
        detail: '回滚步骤必须包含明确命令或操作说明，并指定责任人。',
        suggestedAction: '补齐回滚命令和责任人后重新校验。',
        relatedId: step.id,
      });
    });

  change.resources
    .filter((resource) => resource.type === 'service' && resource.critical)
    .forEach((resource) => {
      if (change.window.observationWindowMinutes < 30) {
        issues.push({
          id: `${change.id}-observation-${resource.id}`,
          changeId: change.id,
          severity: 'warning',
          code: 'OBSERVATION_TOO_SHORT',
          title: `${resource.name} 观察窗口不足`,
          detail: '关键服务建议至少保留 30 分钟观察窗口。',
          suggestedAction: '延长观察窗口，并由业务负责人签署风险接受记录。',
          relatedId: resource.id,
        });
      }
    });

  if (!change.owner.trim() || change.onCall.length === 0) {
    issues.push({
      id: `${change.id}-owner`,
      changeId: change.id,
      severity: 'blocker',
      code: 'OWNER_MISSING',
      title: '缺少变更责任人',
      detail: '变更负责人与值守人员均不能为空。',
      suggestedAction: '指定变更负责人和至少一名值守人员。',
    });
  }

  // 旧记录缺约束时标成待补，不能直接放行。
  if (change.constraintCompleteness === 'incomplete') {
    const actionable = ['draft', 'submitted', 'rejected', 'approved', 'standby'].includes(
      change.status,
    );
    issues.push({
      id: `${change.id}-constraints-incomplete`,
      changeId: change.id,
      severity: actionable ? 'blocker' : 'warning',
      code: 'CONSTRAINTS_INCOMPLETE',
      title: '审阅约束数据待补',
      detail:
        '该记录创建于三类约束接入前，缺少封网日历核对、前序依赖排列或回滚落点/切换容量数据，按要求不能直接放行。',
      suggestedAction: '补齐封网、依赖与回滚落点信息并确认后，方可重新送审。',
    });
  }

  return issues;
}

export function createAudit(action: string, detail: string, actor = '当前用户'): AuditRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    detail,
  };
}
