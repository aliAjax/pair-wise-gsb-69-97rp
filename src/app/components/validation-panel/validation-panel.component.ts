import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { BlackoutPeriod } from '../../models/blackout.model';
import {
  ChangeRequest,
  IssueSeverity,
  ReviewContext,
  validateChange,
} from '../../models/change-request.model';

@Component({
  selector: 'app-validation-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="validation-header" [class.clear]="!issues().length">
      <div>
        <strong>{{ issues().length ? '存在待处理项' : '校验通过' }}</strong>
        <span>
          @if (issues().length) {
            {{ blockers() }} 个阻断项，{{ warnings() }} 个警告，{{ infos() }} 个提示
          } @else {
            封网、依赖、回滚落点与切换容量均通过，可提交审批
          }
        </span>
      </div>
      <span class="status-dot"></span>
    </div>

    @if (blackouts().length) {
      <div class="blackout-strip">
        <span class="strip-label">封网日历</span>
        @for (period of blackouts(); track period.id) {
          <span class="blackout-chip" [title]="period.reason">
            {{ period.name }} · {{ period.start | date: 'MM-dd HH:mm' }} ~
            {{ period.end | date: 'MM-dd HH:mm' }}
            @if (period.scopeResourceIds.length) {
              <small>限定 {{ period.scopeResourceIds.length }} 个资源</small>
            } @else {
              <small>全局</small>
            }
          </span>
        }
      </div>
    }

    @for (issue of issues(); track issue.id) {
      <article
        class="issue"
        [class.warning]="issue.severity === 'warning'"
        [class.info]="issue.severity === 'info'"
      >
        <div class="issue-title">
          <span class="severity">{{ severityText(issue.severity) }}</span>
          <strong>{{ issue.title }}</strong>
        </div>
        <p>{{ issue.detail }}</p>
        <div class="suggested">建议：{{ issue.suggestedAction }}</div>
      </article>
    }
  `,
  styles: [
    `
      .validation-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border: 1px solid #ea9a86;
        background: #fae7e2;
      }

      .validation-header.clear {
        border-color: #8ec9a3;
        background: #e9f6ed;
      }

      .validation-header div {
        display: flex;
        flex-direction: column;
      }

      .validation-header span {
        margin-top: 3px;
        color: #666;
        font-size: 12px;
      }

      .status-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #c21d00;
      }

      .clear .status-dot {
        background: #2f7d4a;
      }

      .blackout-strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        border: 1px solid #d7d7d7;
        border-top: 0;
        background: #f7f4ee;
      }

      .strip-label {
        color: #7c5000;
        font-size: 11px;
        font-weight: 600;
      }

      .blackout-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border: 1px solid #d0a251;
        background: #fff7e6;
        color: #7c5000;
        font-size: 11px;
      }

      .blackout-chip small {
        color: #a9760a;
      }

      .issue {
        padding: 16px;
        border: 1px solid #d7d7d7;
        border-top: 0;
        background: #fff;
      }

      .issue.warning {
        border-left: 3px solid #d99000;
      }

      .issue.info {
        border-left: 3px solid #266c91;
      }

      .issue-title {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .severity {
        padding: 2px 6px;
        background: #c21d00;
        color: #fff;
        font-size: 10px;
      }

      .warning .severity {
        background: #a96800;
      }

      .info .severity {
        background: #266c91;
      }

      p {
        margin: 9px 0;
        color: #4c4c4c;
        line-height: 1.6;
      }

      .suggested {
        color: #266c91;
        font-size: 12px;
      }
    `,
  ],
})
export class ValidationPanelComponent {
  readonly change = input.required<ChangeRequest>();
  readonly allChanges = input.required<ChangeRequest[]>();
  readonly blackouts = input<BlackoutPeriod[]>([]);

  readonly issues = computed(() =>
    validateChange(this.change(), this.allChanges(), this.reviewContext()),
  );
  readonly blockers = computed(
    () => this.issues().filter((issue) => issue.severity === 'blocker').length,
  );
  readonly warnings = computed(
    () => this.issues().filter((issue) => issue.severity === 'warning').length,
  );
  readonly infos = computed(
    () => this.issues().filter((issue) => issue.severity === 'info').length,
  );

  private readonly reviewContext = computed<ReviewContext>(() => ({
    blackouts: this.blackouts(),
  }));

  severityText(severity: IssueSeverity): string {
    return { blocker: '阻断', warning: '警告', info: '提示' }[severity];
  }
}
