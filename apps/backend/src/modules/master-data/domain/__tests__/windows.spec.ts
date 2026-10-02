import { effectiveWindow } from '../windows';

const outlet = (mall: [number, number] | null) => ({
  windowOpenMin: 360,
  windowCloseMin: 600,
  mallWindowOpenMin: mall?.[0] ?? null,
  mallWindowCloseMin: mall?.[1] ?? null,
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
});
