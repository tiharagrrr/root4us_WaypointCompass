import type { ParkingConstraint } from '@waypoint/shared';
import { effectiveWindow } from '../windows';

const outlet = (
  mall: [number, number] | null,
  parkingConstraint: ParkingConstraint = 'MALL_DOCK',
) => ({
  windowOpenMin: 360,
  windowCloseMin: 600,
  mallWindowOpenMin: mall?.[0] ?? null,
  mallWindowCloseMin: mall?.[1] ?? null,
  parkingConstraint,
});

describe('effectiveWindow', () => {
  it('AC-MD-13 effective window meets the mall window', () => {
    expect(effectiveWindow(outlet([420, 540]))).toEqual({
      openMin: 420,
      closeMin: 540,
    });
    expect(effectiveWindow(outlet([300, 480]))).toEqual({
      openMin: 360,
      closeMin: 480,
    });
    expect(effectiveWindow(outlet(null))).toEqual({
      openMin: 360,
      closeMin: 600,
    });
  });

  // The engine narrows by the mall window only at a MALL_DOCK outlet
  // (packages/engine/src/plan/window.ts), so the order's window must too.
  it.each<ParkingConstraint>(['NORMAL', 'VAN_ONLY'])(
    'ignores mall times at a %s outlet, as the engine does',
    (parking) => {
      expect(effectiveWindow(outlet([420, 540], parking))).toEqual({
        openMin: 360,
        closeMin: 600,
      });
    },
  );
});
