import { createReducer, on } from '@ngrx/store';
import {
  ApprovalStage,
  ChangeRequest,
  APPROVAL_ORDER,
  createAudit,
  REVIEW_CONSTRAINT_VERSION,
} from '../models/change-request.model';
import {
  buildReviewSnapshot,
  hasConstraintData,
  isExecutionStandby,
  normalizeChange,
  submissionBlockers,
} from '../models/review-constraints';
import { ChangeRequestActions } from './change-request.actions';

export interface ChangeRequestState {
  changes: ChangeRequest[];
  loading: boolean;
  error: string | null;
}

export const initialChangeRequestState: ChangeRequestState = {
  changes: [],
  loading: false,
  error: null,
};

function touch(change: ChangeRequest): ChangeRequest {
  return { ...change, updatedAt: new Date().toISOString() };
}

function nextPendingStage(change: ChangeRequest): ApprovalStage | null {
  return (
    APPROVAL_ORDER.find((stage) =>
      change.approvals.some((approval) => approval.stage === stage && approval.state === 'pending'),
    ) ?? null
  );
}

function resetApprovals(change: ChangeRequest): ChangeRequest['approvals'] {
  return APPROVAL_ORDER.map((stage) => ({ stage, state: 'pending' as const }));
}

/**
 * 批准后窗口或依赖变化：
 * - 未执行（待会签/已批准/待命）：会签作废，重新送审；
 * - 执行中：只记录影响，会签与状态保持不变。
 */
function applyPostApprovalChange(previous: ChangeRequest, incoming: ChangeRequest): ChangeRequest {
  const baseline = previous.reviewSnapshot ?? buildReviewSnapshot(previous);
  const changed = buildReviewSnapshot(incoming) !== baseline;

  if (!changed) {
    return incoming;
  }

  if (previous.status === 'executing') {
    return {
      ...incoming,
      status: 'executing',
      approvals: previous.approvals,
      reviewSnapshot: previous.reviewSnapshot,
      audit: [
        createAudit('记录约束变化影响', '执行中窗口或依赖发生变化，仅记录影响，已冻结会签不变'),
        ...incoming.audit,
      ],
    };
  }

  return {
    ...incoming,
    status: 'submitted',
    approvals: resetApprovals(incoming),
    reviewSnapshot: undefined,
    audit: [
      createAudit(
        '会签作废重新送审',
        '批准后窗口或依赖发生变化，原会签全部作废，按新方案重新顺序会签',
      ),
      ...incoming.audit,
    ],
  };
}

/** 保存方案时：约束信息补齐即升级为当前约束版本，旧记录随之脱离“待补”。 */
function stampConstraintVersion(change: ChangeRequest): ChangeRequest {
  if (change.constraintVersion === REVIEW_CONSTRAINT_VERSION) {
    return change;
  }
  return hasConstraintData(change)
    ? { ...change, constraintVersion: REVIEW_CONSTRAINT_VERSION }
    : change;
}

export const changeRequestReducer = createReducer(
  initialChangeRequestState,
  on(ChangeRequestActions.loadChanges, (state) => ({ ...state, loading: true, error: null })),
  on(ChangeRequestActions.loadChangesSuccess, (state, { changes }) => ({
    ...state,
    changes: changes.map((change) => normalizeChange(change)),
    loading: false,
  })),
  on(ChangeRequestActions.loadChangesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(ChangeRequestActions.createChange, (state, { change }) => ({
    ...state,
    changes: [
      {
        ...change,
        constraintVersion: change.constraintVersion ?? REVIEW_CONSTRAINT_VERSION,
        audit: [createAudit('创建草稿', `创建变更 ${change.id}`), ...change.audit],
      },
      ...state.changes,
    ],
  })),
  on(ChangeRequestActions.updateChange, (state, { change }) => ({
    ...state,
    changes: state.changes.map((item) => {
      if (item.id !== change.id) {
        return item;
      }
      const stamped = touch(stampConstraintVersion(change));
      const needsRevalidation = ['submitted', 'approved', 'standby', 'executing'].includes(
        item.status,
      );
      return needsRevalidation ? applyPostApprovalChange(item, stamped) : stamped;
    }),
  })),
  on(ChangeRequestActions.deleteDraft, (state, { id }) => ({
    ...state,
    changes: state.changes.filter((change) => change.id !== id || change.status !== 'draft'),
  })),
  on(ChangeRequestActions.submitForReview, (state, { id }) => {
    const target = state.changes.find((change) => change.id === id);
    if (!target || !['draft', 'rejected'].includes(target.status)) {
      return state;
    }
    // 提交被挡住时保留现状：阻断项不清零不进入会签。
    if (submissionBlockers(target, state.changes).length > 0) {
      return state;
    }
    return {
      ...state,
      changes: state.changes.map((change) =>
        change.id === id
          ? touch({
              ...change,
              status: 'submitted',
              approvals: resetApprovals(change),
              reviewSnapshot: buildReviewSnapshot(change),
              constraintVersion: change.constraintVersion ?? REVIEW_CONSTRAINT_VERSION,
              audit: [
                createAudit('提交审批', '三类约束接入审阅单，进入网络、系统、安全、业务顺序会签'),
                ...change.audit,
              ],
            })
          : change,
      ),
    };
  }),
  on(ChangeRequestActions.approveStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) => {
      if (change.id !== id || nextPendingStage(change) !== stage) {
        return change;
      }

      const approvals = change.approvals.map((approval) =>
        approval.stage === stage
          ? {
              ...approval,
              state: 'approved' as const,
              approver,
              comment,
              decidedAt: new Date().toISOString(),
            }
          : approval,
      );
      const allApproved = approvals.every((approval) => approval.state === 'approved');

      if (!allApproved) {
        return touch({
          ...change,
          approvals,
          audit: [
            createAudit('阶段会签', `${stage} 已由 ${approver} 批准：${comment}`),
            ...change.audit,
          ],
        });
      }

      // 终审瞬间再跑一次统一门禁：封网/容量等约束挡住时不允许批准成立。
      const candidate = { ...change, approvals };
      if (submissionBlockers(candidate, state.changes).length > 0) {
        return touch({
          ...change,
          audit: [
            createAudit(
              '终审被约束挡住',
              `${stage} 批准时审阅约束仍存在阻断项，会签未完成，保留现状`,
            ),
            ...change.audit,
          ],
        });
      }

      const standby = isExecutionStandby(candidate, state.changes);
      return touch({
        ...candidate,
        status: standby ? 'standby' : 'approved',
        reviewSnapshot: buildReviewSnapshot(candidate),
        audit: [
          createAudit(
            standby ? '会签完成，停在待命' : '阶段会签',
            standby
              ? `${stage} 已由 ${approver} 批准：${comment}。共享机柜前序未完成，后续停在待命`
              : `${stage} 已由 ${approver} 批准：${comment}`,
          ),
          ...change.audit,
        ],
      });
    }),
  })),
  on(ChangeRequestActions.rejectStage, (state, { id, stage, approver, comment }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? touch({
            ...change,
            status: 'rejected',
            reviewSnapshot: undefined,
            approvals: change.approvals.map((approval) =>
              approval.stage === stage
                ? {
                    ...approval,
                    state: 'rejected',
                    approver,
                    comment,
                    decidedAt: new Date().toISOString(),
                  }
                : approval,
            ),
            audit: [
              createAudit('审批退回', `${stage} 由 ${approver} 退回：${comment}`),
              ...change.audit,
            ],
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.startExecution, (state, { id }) => ({
    ...state,
    // 待命（standby）状态不匹配，前序未完成时无法启动，现状保留。
    changes: state.changes.map((change) =>
      change.id === id && change.status === 'approved'
        ? touch({
            ...change,
            status: 'executing',
            approvals: change.approvals.map((approval) => ({ ...approval, state: 'frozen' })),
            audit: [createAudit('开始执行', '审批记录已冻结，进入执行状态'), ...change.audit],
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.toggleStep, (state, { id, stepId }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? touch({
            ...change,
            steps: change.steps.map((step) =>
              step.id === stepId
                ? {
                    ...step,
                    completed: !step.completed,
                    completedAt: step.completed ? undefined : new Date().toISOString(),
                  }
                : step,
            ),
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.recordDeviation, (state, { id, deviation }) => ({
    ...state,
    changes: state.changes.map((change) =>
      change.id === id
        ? touch({
            ...change,
            deviations: [deviation, ...change.deviations],
            audit: [
              createAudit('记录执行偏离', `${deviation.owner}：${deviation.description}`),
              ...change.audit,
            ],
          })
        : change,
    ),
  })),
  on(ChangeRequestActions.completeExecution, (state, { id, result, note }) => {
    let updated: ChangeRequest[] = state.changes;
    const target = state.changes.find((change) => change.id === id);
    if (target && target.status === 'executing') {
      updated = state.changes.map((change) =>
        change.id === id
          ? touch({
              ...change,
              status: result,
              audit: [
                createAudit(result === 'completed' ? '执行完成' : '执行回滚', note),
                ...change.audit,
              ],
            })
          : change,
      );
    }

    // 前序完成后，解除后续待命；仍有其它前序未完成的继续待命。
    if (result === 'completed') {
      updated = updated.map((change) => {
        if (change.status !== 'standby' || isExecutionStandby(change, updated)) {
          return change;
        }
        return touch({
          ...change,
          status: 'approved',
          audit: [
            createAudit('解除待命', `前序变更 ${id} 已完成，批准恢复有效，可开始执行`),
            ...change.audit,
          ],
        });
      });
    }

    return { ...state, changes: updated };
  }),
);
