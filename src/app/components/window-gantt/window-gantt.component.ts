import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BlackoutPeriod } from '../../models/blackout.model';
import {
  ACTIVE_CHANGE_STATUSES,
  ChangeRequest,
  STATUS_LABELS,
  isWindowOverlapping,
  sharedResources,
} from '../../models/change-request.model';

interface GanttRow {
  id: string;
  title: string;
  owner: string;
  status: string;
  left: number;
  width: number;
  conflicts: boolean;
}

interface BlackoutBand {
  id: string;
  name: string;
  left: number;
  width: number;
  global: boolean;
}

const RANGE_START = new Date('2026-09-29T00:00:00').getTime();
const RANGE_TOTAL_MINUTES = 4 * 24 * 60;

@Component({
  selector: 'app-window-gantt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gantt-shell">
      <div class="axis">
        @for (day of days; track day) {
          <span>{{ day }}</span>
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
              @for (band of bands(); track band.id) {
                <div
                  class="blackout-band"
                  [class.global]="band.global"
                  [style.left.%]="band.left"
                  [style.width.%]="band.width"
                  [title]="band.name"
                >
                  {{ band.name }}
                </div>
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
      <div class="legend">
        <span class="legend-bar"></span>变更窗口 <span class="legend-band"></span>封网时段
        <span class="legend-conflict"></span>窗口冲突
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
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        margin-left: 230px;
        border-bottom: 1px solid #d7d7d7;
        background: #f2f4f6;
      }

      .axis span {
        padding: 10px 12px;
        border-left: 1px solid #d7d7d7;
        font-size: 12px;
        color: #555;
      }

      .rows {
        position: relative;
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
        background: repeating-linear-gradient(
          to right,
          #f2f4f6,
          #f2f4f6 calc(25% - 1px),
          #d7d7d7 25%
        );
        overflow: hidden;
      }

      .blackout-band {
        position: absolute;
        top: 0;
        bottom: 0;
        background: repeating-linear-gradient(
          45deg,
          rgba(214, 123, 100, 0.18),
          rgba(214, 123, 100, 0.18) 6px,
          rgba(214, 123, 100, 0.3) 6px,
          rgba(214, 123, 100, 0.3) 12px
        );
        border-left: 1px dashed #c21d00;
        border-right: 1px dashed #c21d00;
        color: #8e260f;
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .blackout-band.global {
        background: repeating-linear-gradient(
          45deg,
          rgba(194, 29, 0, 0.14),
          rgba(194, 29, 0, 0.14) 6px,
          rgba(194, 29, 0, 0.26) 6px,
          rgba(194, 29, 0, 0.26) 12px
        );
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

      .legend {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-top: 1px solid #e5e5e5;
        color: #666;
        font-size: 11px;
      }

      .legend-bar,
      .legend-band,
      .legend-conflict {
        display: inline-block;
        width: 18px;
        height: 10px;
        margin-left: 12px;
      }

      .legend-bar {
        margin-left: 0;
        border-left: 4px solid #266c91;
        background: #c8e3f2;
      }

      .legend-band {
        background: rgba(194, 29, 0, 0.22);
        outline: 1px dashed #c21d00;
      }

      .legend-conflict {
        border-left: 4px solid #c21d00;
        background: #f2c9c1;
      }
    `,
  ],
})
export class WindowGanttComponent {
  readonly changes = input.required<ChangeRequest[]>();
  readonly selectedId = input<string>('');
  readonly blackouts = input<BlackoutPeriod[]>([]);
  readonly days = ['09-29 周二', '09-30 周三', '10-01 周四', '10-02 周五'];

  readonly bands = computed<BlackoutBand[]>(() =>
    this.blackouts().map((period) => {
      const start = new Date(period.start).getTime();
      const end = new Date(period.end).getTime();
      const left = Math.max(0, ((start - RANGE_START) / 60_000 / RANGE_TOTAL_MINUTES) * 100);
      const width = Math.min(
        100 - left,
        Math.max(0, ((end - start) / 60_000 / RANGE_TOTAL_MINUTES) * 100),
      );
      return {
        id: period.id,
        name: period.name,
        left,
        width,
        global: period.scopeResourceIds.length === 0,
      };
    }),
  );

  readonly rows = computed<GanttRow[]>(() => {
    const changes = this.changes();

    return changes.map((change) => {
      const leftMinutes = (new Date(change.window.start).getTime() - RANGE_START) / 60_000;
      const duration =
        (new Date(change.window.end).getTime() - new Date(change.window.start).getTime()) / 60_000;
      const conflicts = changes.some(
        (candidate) =>
          candidate.id !== change.id &&
          ACTIVE_CHANGE_STATUSES.includes(candidate.status) &&
          sharedResources(change, candidate).length > 0 &&
          isWindowOverlapping(change.window, candidate.window),
      );

      return {
        id: change.id,
        title: change.title,
        owner: change.owner,
        status: STATUS_LABELS[change.status],
        left: Math.max(0, Math.min(98, (leftMinutes / RANGE_TOTAL_MINUTES) * 100)),
        width: Math.max(2, Math.min(100, (duration / RANGE_TOTAL_MINUTES) * 100)),
        conflicts,
      };
    });
  });
}
