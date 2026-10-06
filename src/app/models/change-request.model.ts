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

export interface ChangeResource {
  id: string;
  name: string;
  type: ResourceType;
  critical: boolean;
  dependencies: string[];
  /** 资源总容量单元（切换目标容量核算用），缺省表示未登记。 */
  capacityUnits?: number;
  /** 已被在途/已批准变更承诺占用的容量单元。 */
  committedCapacityUnits?: number;
}

/** 切换目标与所需容量，参与审阅单容量门禁。 */
export interface CutoverPlan {
  targetResourceId: string;
  requiredCapacityUnits: number;
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
  /** 回滚落点资源 ID，回滚步骤必填；命中封网资源时提交被挡住。 */
  landingResourceIds?: string[];
}

export interface ChangeWindow {
  start: string;
  end: string;
  observationWindowMinutes: number;
  blackoutProtected: boolean;
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
  /** 切换目标与所需容量，容量不足时提交被挡住。 */
  cutover?: CutoverPlan;
  /** 审阅约束版本，缺省表示旧记录，需要待补。 */
  constraintVersion?: string;
  /** 批准时窗口与依赖的指纹，用于发现批准后的变化。 */
  reviewSnapshot?: string;
  approvals: ApprovalRecord[];
  deviations: DeviationRecord[];
  audit: AuditRecord[];
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
    | 'BLACKOUT_CALENDAR_CONFLICT'
    | 'ROLLBACK_LANDING_BLACKOUT'
    | 'CUTOVER_CAPACITY_INSUFFICIENT'
    | 'PREDECESSOR_NOT_READY'
    | 'CONSTRAINT_PENDING_SUPPLEMENT';
  title: string;
  detail: string;
  suggestedAction: string;
  relatedId?: string;
}

export const APPROVAL_ORDER: ApprovalStage[] = ['network', 'system', 'security', 'business'];

/** 审阅单当前采用的约束版本。旧记录缺少该版本时必须“待补”，不能直接放行。 */
export const REVIEW_CONSTRAINT_VERSION = 'review-v2';

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
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
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
    cutover: { targetResourceId: '', requiredCapacityUnits: 0 },
    constraintVersion: REVIEW_CONSTRAINT_VERSION,
    approvals: createEmptyApprovals(),
    deviations: [],
    audit: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
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

/** 与其他有效变更是否存在“非依赖串联”的共享资源窗口冲突。 */
export function hasWindowConflict(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ChangeRequest | null {
  const ownResourceIds = new Set(change.resources.map((resource) => resource.id));
  const referencedDependencyIds = new Set(
    change.resources.flatMap((resource) => resource.dependencies),
  );

  for (const candidate of allChanges) {
    if (
      candidate.id === change.id ||
      ['draft', 'rejected', 'rolled_back'].includes(candidate.status) ||
      !isWindowOverlapping(change.window, candidate.window)
    ) {
      continue;
    }
    const shared = candidate.resources.some(
      (candidateResource) =>
        ownResourceIds.has(candidateResource.id) &&
        // 依赖前序独占资源的窗口交叠由依赖顺序承接，不算冲突。
        !(
          !change.resources.some((resource) => resource.id === candidateResource.id) &&
          referencedDependencyIds.has(candidateResource.id)
        ),
    );
    if (shared) {
      return candidate;
    }
  }
  return null;
}

export function validateChange(
  change: ChangeRequest,
  allChanges: ChangeRequest[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resourceMap = new Map(change.resources.map((resource) => [resource.id, resource]));
  const referencedDependencyIds = new Set(
    change.resources.flatMap((resource) => resource.dependencies),
  );

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
        !['draft', 'rejected', 'rolled_back'].includes(candidate.status) &&
        isWindowOverlapping(change.window, candidate.window),
    )
    .forEach((candidate) => {
      const shared = change.resources.filter((resource) =>
        candidate.resources.some((candidateResource) => candidateResource.id === resource.id),
      );
      // 共享机柜变更按依赖排列：本变更显式依赖前序变更独占的资源时，
      // 窗口交叠由依赖顺序串行承接，不再重复判为窗口冲突。
      const linkedByPredecessor = candidate.resources.some(
        (candidateResource) =>
          !resourceMap.has(candidateResource.id) &&
          referencedDependencyIds.has(candidateResource.id),
      );
      if (shared.length > 0 && !linkedByPredecessor) {
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
