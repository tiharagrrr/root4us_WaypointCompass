import type { AppConfig } from '../../../config/app-config';
import { ClockService } from '../clock.service';

const config = (demo: { enabled: boolean; clock?: string }) =>
  ({ demo }) as AppConfig;

describe('ClockService', () => {
  afterEach(() => jest.useRealTimers());

  it('runs on the wall clock by default', () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z') });
    const clock = new ClockService(config({ enabled: true }));
    expect(clock.mode()).toEqual({ mode: 'real' });
    expect(clock.now().toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('starts at DEMO_CLOCK and keeps running, only in demo mode', () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T04:00:00Z') });
    const demo = new ClockService(
      config({ enabled: true, clock: '2026-10-01T15:55:00+05:30' }),
    );
    expect(demo.toIso(demo.now())).toBe('2026-10-01T15:55:00+05:30');
    jest.advanceTimersByTime(5 * 60_000);
    expect(demo.toIso(demo.now())).toBe('2026-10-01T16:00:00+05:30');
    expect(demo.realNow().toISOString()).toBe('2026-10-01T04:05:00.000Z');

    const live = new ClockService(
      config({ enabled: false, clock: '2026-10-01T15:55:00+05:30' }),
    );
    expect(live.mode()).toEqual({ mode: 'real' });
  });

  it('freezes, shifts, simulates and returns to real', () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T04:00:00Z') });
    const clock = new ClockService(config({ enabled: true }));

    clock.freeze('2026-10-01T15:59:00+05:30');
    jest.advanceTimersByTime(60_000);
    expect(clock.toIso(clock.now())).toBe('2026-10-01T15:59:00+05:30');

    clock.set({ mode: 'offset', offsetMs: 3_600_000 });
    expect(clock.now().toISOString()).toBe('2026-10-01T05:01:00.000Z');

    clock.set({
      mode: 'simulated',
      runId: 'normal-day',
      at: '2026-10-02T05:15:00+05:30',
    });
    expect(clock.businessDate()).toBe('2026-10-02');

    clock.reset();
    expect(clock.now().toISOString()).toBe('2026-10-01T04:01:00.000Z');
    expect(() => clock.set({ mode: 'frozen', at: 'tomorrow' })).toThrow();
  });

  it('gives Asia/Colombo business dates and minutes of the day', () => {
    const clock = new ClockService(config({ enabled: false }));
    // 18:45 UTC is 00:15 the next day in Colombo.
    const at = new Date('2026-10-01T18:45:00Z');
    expect(clock.businessDate(at)).toBe('2026-10-02');
    expect(clock.businessDate(at, 1)).toBe('2026-10-03');
    expect(clock.minutesOfDay(at)).toBe(15);
    expect(clock.minutesOfDay(new Date('2026-10-01T10:29:00Z'))).toBe(959);
    expect(clock.toIso(at)).toBe('2026-10-02T00:15:00+05:30');
  });
});
