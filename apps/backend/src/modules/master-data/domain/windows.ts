import type { ParkingConstraint } from '@waypoint/shared';

/** Receiving windows, as minutes after midnight (0 = Monday for weekdays). */
export interface TimeWindow {
  openMin: number;
  closeMin: number;
}

export interface WindowedOutlet {
  windowOpenMin: number;
  windowCloseMin: number;
  mallWindowOpenMin: number | null;
  mallWindowCloseMin: number | null;
  parkingConstraint: ParkingConstraint;
}

/**
 * When a vehicle may actually unload at an outlet: its receiving window
 * narrowed by the mall's at a MALL_DOCK outlet (AC-MD-13). Mall times on any
 * other outlet are ignored, exactly as the engine's `effectiveWindow` ignores
 * them (packages/engine/src/plan/window.ts), so the window a screen shows and
 * the one the planner checks never disagree.
 */
export function effectiveWindow(outlet: WindowedOutlet): TimeWindow {
  const { mallWindowOpenMin: open, mallWindowCloseMin: close } = outlet;
  if (outlet.parkingConstraint !== 'MALL_DOCK' || open == null || close == null)
    return { openMin: outlet.windowOpenMin, closeMin: outlet.windowCloseMin };
  return {
    openMin: Math.max(outlet.windowOpenMin, open),
    closeMin: Math.min(outlet.windowCloseMin, close),
  };
}
