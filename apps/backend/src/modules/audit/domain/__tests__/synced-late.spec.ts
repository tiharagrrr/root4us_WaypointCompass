import { syncedLate } from '../synced-late';

const at = (time: string) => new Date(`2026-10-02T${time}+05:30`);

describe('syncedLate', () => {
  it('AC-AUD-03 a row recorded 9 minutes after it happened is synced late', () => {
    expect(syncedLate(at('04:22:00'), at('04:31:00'))).toBe(true);
  });

  it('AC-AUD-03 a row that trails by exactly 5 minutes is not synced late', () => {
    expect(syncedLate(at('02:40:00'), at('02:45:00'))).toBe(false);
  });

  it('a row recorded as it happened is not synced late', () => {
    expect(syncedLate(at('04:22:00'), at('04:22:00'))).toBe(false);
  });
});
