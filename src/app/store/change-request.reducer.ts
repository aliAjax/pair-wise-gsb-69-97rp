import { createReducer, on } from '@ngrx/store';
import { BlackoutPeriod } from '../models/blackout.model';
import {
  ApprovalStage,
  ChangeRequest,
  APPROVAL_ORDER,
  buildConstraintSnapshot,
  createAudit,
  detectConstraintDrift,
  getSubmissionBlockers,
  normalizeLegacyChange,
  unfinishedPrerequisites,
} from '../models/change-request.model';
import { ChangeRequestActions } from './change-request.actions';

export interface ChangeRequestState {
  changes: ChangeRequest[];
  blackouts: BlackoutPeriod[];
  blackoutsLoaded: boolean;
  loading: boolean;
  error: string | null;
}

export const initialChangeRequestState: ChangeRequestState = {
  changes: [],
  blackouts: [],
  blackoutsLoaded: false,
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
  return change.approvals.map((approval) => ({ stage: approval.stage, state: 'pending' as const }));
}

/**
 * 批准后窗口或依赖发生变化：
 * - 未执行（已批准/待命）：会签作废、回到待会签重新送审；
 * - 执行中：不重新送审，只在审计轨迹记录影响。
 */
function reconcileConstraints(
  changes: ChangeRequest[],
  blackouts: BlackoutPeriod[],
  options: { blackoutsLoaded?: boolean } = {},
): ChangeRequest[] {
  return changes.map((change) => {
    if (change.status === 'approved' || change.status === 'standby') {
      const drifts = detectConstraintDrift(change, changes, blackouts, {
        skipBlackout: !options.blackoutsLoaded,
      });
      if (drifts.length > 0) {
        return touch({
          ...change,
          status: 'submitted',
          approvals: resetApprovals(change),
          constraintSnapshot: undefined,
          audit: [
            createAudit(
              '会签作废',
              `批准后约束发生变化：${drifts.map((drift) => drift.detail).join('')}未执行的会签作废，需重新送审。`,
            ),
            ...change.audit,
          ],
        });
      }
    }

    if (change.status === 'executing') {
      const drifts = detectConstraintDrift(change, changes, blackouts, {
        skipBlackout: !options.blackoutsLoaded,
      });
      if (drifts.length > 0) {
        const detail = drifts.map((drift) => drift.detail).join('');
        const alreadyRecorded = change.audit.some(
          (record) => record.action === '约束变化影响（执行中）' && record.detail.includes(detail),
        );
        if (!alreadyRecorded) {
          return touch({
            ...change,
            audit: [
              createAudit(
                '约束变化影响（执行中）',
                `${detail}变更已在执行中，不重新送审，仅记录影响。`,
              ),
              ...change.audit,
            ],
          });
        }
      }
    }

    // 已批准但前序未完成：后续变更停在待命，不进入执行。
    if (change.status === 'approved') {
      const waiting = unfinishedPrerequisites(change, changes);
      if (waiting.length > 0) {
        return touch({
          ...change,
          status: 'standby',
          audit: [
            createAudit(
              '进入待命',
              `前序 ${waiting.map((item) => item.id).join('、')} 未完成，后续变更停在待命。`,
            ),
            ...change.audit,
          ],
        });
      }
    }

    // 前序全部完成：待命变更自动解除，回到已批准等待启动。
    if (change.status === 'standby' && unfinishedPrerequisites(change, changes).length === 0) {
      return touch({
        ...change,
        status: 'approved',
        audit: [
          createAudit('解除待命', '前序变更均已完成，恢复为已批准，可启动执行。'),
          ...change.audit,
        ],
      });
    }

    return change;
  });
}

export const changeRequestReducer = createReducer(
  initialChangeRequestState,
  on(ChangeRequestActions.loadChanges, (state) => ({ ...state, loading: true, error: null })),
  on(ChangeRequestActions.loadChangesSuccess, (state, { changes }) => ({
    ...state,
    changes: reconcileConstraints(
      changes.map((change) => normalizeLegacyChange(change)),
      state.blackouts,
      { blackoutsLoaded: state.blackoutsLoaded },
    ),
    loading: false,
  })),
  on(ChangeRequestActions.loadChangesFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),
  on(ChangeRequestActions.loadBlackouts, (state) => ({ ...state })),
  on(ChangeRequestActions.loadBlackoutsSuccess, (state, { blackouts }) => ({
    ...state,
    blackouts,
    blackoutsLoaded: true,
    changes: reconcileConstraints(state.changes, blackouts, { blackoutsLoaded: true }),
  })),
  on(ChangeRequestActions.loadBlackoutsFailure, (state, { error }) => ({ ...state, error })),
  on(ChangeRequestActions.createChange, (state, { change }) => ({
    ...state,
    changes: [
      {
        ...change,
        constraintCompleteness: 'complete',
        audit: [createAudit('创建草稿', `创建变更 ${change.id}`), ...change.audit],
      },
      ...state.changes,
    ],
  })),
  on(ChangeRequestActions.updateChange, (state, { change }) => {
    const updated = state.changes.map((item) =>
      item.id === change.id
        ? touch({
            ...change,
            audit: [createAudit('保存变更方案', '更新资源、步骤或窗口信息'), ...change.audit],
          })
        : item,
    );
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
  on(ChangeRequestActions.deleteDraft, (state, { id }) => {
    const updated = state.changes.filter((change) => change.id !== id || change.status !== 'draft');
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
  on(ChangeRequestActions.submitForReview, (state, { id }) => {
    const target = state.changes.find((change) => change.id === id);
    if (!target || !['draft', 'rejected'].includes(target.status)) {
      return state;
    }
    // 三类约束与原有阻断项同一张审阅单：任一阻断项存在时不允许送审。
    const blockers = getSubmissionBlockers(target, state.changes, {
      blackouts: state.blackouts,
    });
    if (blockers.length > 0) {
      return state;
    }
    const updated = state.changes.map((change) =>
      change.id === id
        ? touch({
            ...change,
            status: 'submitted',
            approvals: resetApprovals(change),
            audit: [
              createAudit('提交审批', '封网日历、前序依赖、回滚落点与切换容量均通过后进入顺序会签'),
              ...change.audit,
            ],
          })
        : change,
    );
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
  on(ChangeRequestActions.approveStage, (state, { id, stage, approver, comment }) => {
    const change = state.changes.find((item) => item.id === id);
    if (!change || nextPendingStage(change) !== stage) {
      return state;
    }
    // 同一张审阅单：会签期间出现任一阻断项（含旧记录待补）时不得签署放行。
    const blockers = getSubmissionBlockers(change, state.changes, {
      blackouts: state.blackouts,
    });
    if (blockers.length > 0) {
      return {
        ...state,
        changes: state.changes.map((item) =>
          item.id === id
            ? touch({
                ...item,
                audit: [
                  createAudit(
                    '会签被阻断',
                    `${stage} 尝试批准时审阅单仍存在阻断项：${blockers
                      .map((issue) => issue.title)
                      .join('；')}，不能放行。`,
                  ),
                  ...item.audit,
                ],
              })
            : item,
        ),
      };
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
    const allApproved = approvals.every((approval) =>
      approval.stage === stage ? true : approval.state === 'approved',
    );

    const updated = state.changes.map((item) =>
      item.id === id
        ? touch({
            ...item,
            // 批准通过即冻结约束快照，作为后续窗口/依赖变化的比对基线。
            status: allApproved ? 'approved' : 'submitted',
            approvals,
            constraintSnapshot: allApproved
              ? buildConstraintSnapshot(item, state.changes, state.blackouts)
              : item.constraintSnapshot,
            audit: [
              createAudit('阶段会签', `${stage} 已由 ${approver} 批准：${comment}`),
              ...item.audit,
            ],
          })
        : item,
    );
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
  on(ChangeRequestActions.rejectStage, (state, { id, stage, approver, comment }) => {
    const change = state.changes.find((item) => item.id === id);
    if (!change || nextPendingStage(change) !== stage) {
      return state;
    }
    const updated = state.changes.map((item) =>
      item.id === id
        ? touch({
            ...item,
            status: 'rejected',
            approvals: item.approvals.map((approval) =>
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
              ...item.audit,
            ],
          })
        : item,
    );
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
  on(ChangeRequestActions.startExecution, (state, { id }) => {
    const change = state.changes.find((item) => item.id === id);
    if (!change || change.status !== 'approved') {
      return state;
    }

    // 前序没完成时后续停在待命，不进入执行。
    const waiting = unfinishedPrerequisites(change, state.changes);
    if (waiting.length > 0) {
      const updated = state.changes.map((item) =>
        item.id === id
          ? touch({
              ...item,
              status: 'standby',
              audit: [
                createAudit(
                  '进入待命',
                  `前序 ${waiting.map((item) => item.id).join('、')} 未完成，后续变更停在待命。`,
                ),
                ...item.audit,
              ],
            })
          : item,
      );
      return {
        ...state,
        changes: reconcileConstraints(updated, state.blackouts, {
          blackoutsLoaded: state.blackoutsLoaded,
        }),
      };
    }

    const updated = state.changes.map((item) =>
      item.id === id
        ? touch({
            ...item,
            status: 'executing',
            approvals: item.approvals.map((approval) => ({ ...approval, state: 'frozen' })),
            audit: [createAudit('开始执行', '审批记录已冻结，进入执行状态'), ...item.audit],
          })
        : item,
    );
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
  on(ChangeRequestActions.promoteFromStandby, (state, { id }) => {
    const change = state.changes.find((item) => item.id === id);
    if (!change || change.status !== 'standby') {
      return state;
    }
    if (unfinishedPrerequisites(change, state.changes).length > 0) {
      return state;
    }
    const updated = state.changes.map((item) =>
      item.id === id
        ? touch({
            ...item,
            status: 'executing',
            approvals: item.approvals.map((approval) => ({ ...approval, state: 'frozen' })),
            audit: [
              createAudit('待命解除并开始执行', '前序均已完成，审批记录冻结。'),
              ...item.audit,
            ],
          })
        : item,
    );
    return { ...state, changes: updated };
  }),
  on(ChangeRequestActions.supplementConstraints, (state, { id }) => {
    const updated = state.changes.map((item) =>
      item.id === id
        ? touch({
            ...item,
            constraintCompleteness: 'complete',
            audit: [
              createAudit('补齐审阅约束', '已补录封网日历核对、前序依赖、回滚落点与切换容量数据。'),
              ...item.audit,
            ],
          })
        : item,
    );
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
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
    const updated = state.changes.map((change) =>
      change.id === id && change.status === 'executing'
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
    // 前序完成后，待命的后续变更自动解除待命。
    return {
      ...state,
      changes: reconcileConstraints(updated, state.blackouts, {
        blackoutsLoaded: state.blackoutsLoaded,
      }),
    };
  }),
);
