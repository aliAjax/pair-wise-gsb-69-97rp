import { isWindowOverlapping, ChangeWindow } from './change-request.model';

/**
 * 封网日历条目。scopeResourceIds 为空表示全局封网；
 * 非空时只对落到这些资源（机房、机柜、网络、存储、服务）的变更生效。
 */
export interface BlackoutPeriod {
  id: string;
  name: string;
  start: string;
  end: string;
  scopeResourceIds: string[];
  reason: string;
}

/** 判断封网条目作用域是否覆盖某个资源（空作用域 = 全局）。 */
export function isResourceInBlackoutScope(blackout: BlackoutPeriod, resourceId: string): boolean {
  return blackout.scopeResourceIds.length === 0 || blackout.scopeResourceIds.includes(resourceId);
}

/** 判断封网条目作用域是否覆盖一组资源中的任意一个。 */
export function blackoutCoversAnyResource(
  blackout: BlackoutPeriod,
  resourceIds: Iterable<string>,
): boolean {
  if (blackout.scopeResourceIds.length === 0) {
    return true;
  }
  for (const resourceId of resourceIds) {
    if (blackout.scopeResourceIds.includes(resourceId)) {
      return true;
    }
  }
  return false;
}

/** 窗口与封网时段是否重叠（半开区间，与窗口冲突判定一致）。 */
export function isWindowInBlackout(window: ChangeWindow, blackout: BlackoutPeriod): boolean {
  return isWindowOverlapping(window, { start: blackout.start, end: blackout.end } as ChangeWindow);
}
