import { DEFERRAL_REASON_CODES, DEFERRAL_REASONS } from '@waypoint/engine';
import { deferralReasonRows } from '../deferral-reasons.seed';

describe('deferralReasonRows', () => {
  it('seeds exactly the reason codes the engine and the dispatcher use', () => {
    expect(deferralReasonRows().map((r) => r.code)).toEqual([
      ...DEFERRAL_REASON_CODES,
    ]);
  });

  it('gives each engine reason its store wording as the description', () => {
    const rows = new Map(deferralReasonRows().map((r) => [r.code, r]));
    for (const reason of DEFERRAL_REASONS) {
      expect(rows.get(reason.code)).toEqual({
        code: reason.code,
        label: reason.label,
        description: reason.storeText,
        fromEngine: reason.fromEngine,
        sortOrder: reason.sortOrder,
      });
    }
    expect(rows.get('OVER_CAPACITY')?.description).toBe(
      'Every suitable vehicle was full for this run.',
    );
  });
});
