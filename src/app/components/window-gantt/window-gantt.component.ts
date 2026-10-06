import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ChangeRequest, hasWindowConflict, STATUS_LABELS } from '../../models/change-request.model';

interface GanttRow {
  id: string;
  title: string;
  owner: string;
  status: string;
  left: number;
  width: number;
  conflicts: boolean;
}

@Component({
  selector: 'app-window-gantt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gantt-shell">
      <div class="axis">
        @for (day of axisMarks(); track day.label) {
          <span [style.left.%]="day.left">{{ day.label }}</span>
        }
      </div>
      <div class="rows">
        @for (row of rows(); track row.id) {
          <div class="gantt-row" [class.active]="row.id === selectedId()">
            <div class="row-label">
              <strong>{{ row.title }}</strong>
              <span>{{ row.id }} · {{ row.owner }}</span>
            </div>
            <div class="track">
              @for (mark of axisMarks(); track mark.label) {
                <span class="grid-line" [style.left.%]="mark.left"></span>
              }
              <div
                class="bar"
                [class.conflict]="row.conflicts"
                [style.left.%]="row.left"
                [style.width.%]="row.width"
                [title]="row.status"
              >
                {{ row.status }}
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .gantt-shell {
        border: 1px solid #d7d7d7;
        background: #ffffff;
        overflow: hidden;
      }

      .axis {
        position: relative;
        height: 36px;
        margin-left: 230px;
        border-bottom: 1px solid #d7d7d7;
        background: #f2f4f6;
      }

      .axis span {
        position: absolute;
        top: 10px;
        padding-left: 8px;
        border-left: 1px solid #d7d7d7;
        font-size: 12px;
        color: #555;
        white-space: nowrap;
      }

      .gantt-row {
        display: grid;
        grid-template-columns: 230px 1fr;
        min-height: 68px;
        border-bottom: 1px solid #e5e5e5;
      }

      .gantt-row:last-child {
        border-bottom: 0;
      }

      .gantt-row.active {
        background: #f0f7fb;
      }

      .row-label {
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 8px 16px;
      }

      .row-label strong {
        color: #1b1b1b;
        font-size: 13px;
      }

      .row-label span {
        margin-top: 4px;
        color: #707070;
        font-size: 11px;
      }

      .track {
        position: relative;
        margin: 15px 16px;
        height: 36px;
        border-left: 1px solid #d7d7d7;
        background: #f2f4f6;
      }

      .grid-line {
        position: absolute;
        top: 0;
        bottom: 0;
        border-left: 1px solid #e0e0e0;
      }

      .bar {
        position: absolute;
        top: 4px;
        height: 28px;
        min-width: 28px;
        padding: 5px 8px;
        box-sizing: border-box;
        border-left: 4px solid #266c91;
        background: #c8e3f2;
        color: #174d6a;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bar.conflict {
        border-left-color: #c21d00;
        background: #f2c9c1;
        color: #7f1808;
      }
    `,
  ],
})
export class WindowGanttComponent {
  readonly changes = input.required<ChangeRequest[]>();
  readonly selectedId = input<string>('');

  readonly axisMarks = computed(() => {
    const start = new Date('2026-09-29T00:00:00').getTime();
    const total = 11 * 24 * 60;
    return [
      { label: '09-29 周二', offsetDays: 0 },
      { label: '09-30 周三', offsetDays: 1 },
      { label: '10-01 周四', offsetDays: 2 },
      { label: '10-02 周五', offsetDays: 3 },
      { label: '10-09 周五', offsetDays: 10 },
    ].map((mark) => ({
      label: mark.label,
      left: ((mark.offsetDays * 24 * 60) / total) * 100,
    }));
  });

  readonly rows = computed<GanttRow[]>(() => {
    const start = new Date('2026-09-29T00:00:00').getTime();
    const totalDays = 11;
    const total = totalDays * 24 * 60;
    const changes = this.changes();

    return changes.map((change) => {
      const leftMinutes = (new Date(change.window.start).getTime() - start) / 60_000;
      const duration =
        (new Date(change.window.end).getTime() - new Date(change.window.start).getTime()) / 60_000;
      const conflicts = hasWindowConflict(change, changes) !== null;

      return {
        id: change.id,
        title: change.title,
        owner: change.owner,
        status: STATUS_LABELS[change.status],
        left: Math.max(0, Math.min(98, (leftMinutes / total) * 100)),
        width: Math.max(2, Math.min(100, (duration / total) * 100)),
        conflicts,
      };
    });
  });
}
