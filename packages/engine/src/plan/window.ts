import type { EngineOutlet } from '../types';

/** The outlet window, narrowed by the mall window at a mall-dock outlet. Minutes after midnight. */
export function effectiveWindow(outlet: EngineOutlet): { openMin: number; closeMin: number } {
  const mall =
    outlet.parkingConstraint === 'MALL_DOCK' && outlet.mallWindowOpenMin !== null && outlet.mallWindowCloseMin !== null;
  if (!mall) return { openMin: outlet.windowOpenMin, closeMin: outlet.windowCloseMin };
  return {
    openMin: Math.max(outlet.windowOpenMin, outlet.mallWindowOpenMin ?? 0),
    closeMin: Math.min(outlet.windowCloseMin, outlet.mallWindowCloseMin ?? 0),
  };
}
