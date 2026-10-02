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
}

/**
 * When a vehicle may actually unload at an outlet: its receiving window
 * narrowed by the mall's, when the outlet sits in one (AC-MD-13). The engine
 * and the order's `deliveryWindow` both read this, so a screen and a plan
 * never disagree about the hours.
 */
export function effectiveWindow(outlet: WindowedOutlet): TimeWindow {
  const { mallWindowOpenMin: open, mallWindowCloseMin: close } = outlet;
  if (open == null || close == null)
    return { openMin: outlet.windowOpenMin, closeMin: outlet.windowCloseMin };
  return {
    openMin: Math.max(outlet.windowOpenMin, open),
    closeMin: Math.min(outlet.windowCloseMin, close),
  };
}
