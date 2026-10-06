import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { catchError, map, of, switchMap, tap, withLatestFrom } from 'rxjs';
import { ChangeRequestService } from '../services/change-request.service';
import { ChangeRequestActions } from './change-request.actions';
import { selectAllChanges, selectBlackouts } from './change-request.selectors';

@Injectable()
export class ChangeRequestEffects {
  private readonly actions$ = inject(Actions);
  private readonly service = inject(ChangeRequestService);
  private readonly store = inject(Store);

  loadChanges$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChangeRequestActions.loadChanges),
      switchMap(() =>
        this.service.load().pipe(
          map((changes) => ChangeRequestActions.loadChangesSuccess({ changes })),
          catchError((error: unknown) =>
            of(
              ChangeRequestActions.loadChangesFailure({
                error: error instanceof Error ? error.message : '变更数据加载失败',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  loadBlackouts$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ChangeRequestActions.loadBlackouts),
      switchMap(() =>
        this.service.loadBlackouts().pipe(
          map((blackouts) => ChangeRequestActions.loadBlackoutsSuccess({ blackouts })),
          catchError((error: unknown) =>
            of(
              ChangeRequestActions.loadBlackoutsFailure({
                error: error instanceof Error ? error.message : '封网日历加载失败',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  persistChanges$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(
          ChangeRequestActions.createChange,
          ChangeRequestActions.updateChange,
          ChangeRequestActions.deleteDraft,
          ChangeRequestActions.submitForReview,
          ChangeRequestActions.approveStage,
          ChangeRequestActions.rejectStage,
          ChangeRequestActions.startExecution,
          ChangeRequestActions.promoteFromStandby,
          ChangeRequestActions.supplementConstraints,
          ChangeRequestActions.toggleStep,
          ChangeRequestActions.recordDeviation,
          ChangeRequestActions.completeExecution,
        ),
        withLatestFrom(this.store.select(selectAllChanges)),
        tap(([, changes]) => this.service.save(changes)),
      ),
    { dispatch: false },
  );

  persistBlackouts$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ChangeRequestActions.loadBlackoutsSuccess),
        withLatestFrom(this.store.select(selectBlackouts)),
        tap(([, blackouts]) => this.service.saveBlackouts(blackouts)),
      ),
    { dispatch: false },
  );
}
