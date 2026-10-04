import { confirmMode } from '../confirmable';

const eta = new Date('2026-10-02T04:10:00+05:30');

describe('confirmMode', () => {
  it('is NORMAL once the delivery is DELIVERED or PARTIAL', () => {
    for (const orderStatus of ['DELIVERED', 'PARTIAL']) {
      expect(
        confirmMode(
          {
            orderStatus,
            hasReceipt: false,
            stopStatus: orderStatus,
            etaAt: eta,
          },
          new Date('2026-10-02T09:10:00+05:30'),
        ),
      ).toBe('NORMAL');
    }
  });

  it('is EARLY after the ETA while the driver is still on the road', () => {
    expect(
      confirmMode(
        {
          orderStatus: 'IN_TRANSIT',
          hasReceipt: false,
          stopStatus: 'PENDING',
          etaAt: eta,
        },
        new Date('2026-10-02T04:40:00+05:30'),
      ),
    ).toBe('EARLY');
  });

  it('is null before the ETA, with no delivery', () => {
    expect(
      confirmMode(
        {
          orderStatus: 'IN_TRANSIT',
          hasReceipt: false,
          stopStatus: 'PENDING',
          etaAt: eta,
        },
        new Date('2026-10-02T03:55:00+05:30'),
      ),
    ).toBeNull();
  });

  it('is null without an ETA, and for an order that has not left', () => {
    const now = new Date('2026-10-02T09:00:00+05:30');
    expect(
      confirmMode(
        {
          orderStatus: 'IN_TRANSIT',
          hasReceipt: false,
          stopStatus: 'PENDING',
          etaAt: null,
        },
        now,
      ),
    ).toBeNull();
    expect(
      confirmMode(
        {
          orderStatus: 'LOADED',
          hasReceipt: false,
          stopStatus: 'PENDING',
          etaAt: eta,
        },
        now,
      ),
    ).toBeNull();
  });

  it('is null once confirmed, and it does not auto-confirm as days pass', () => {
    expect(
      confirmMode(
        {
          orderStatus: 'RECEIVED',
          hasReceipt: true,
          stopStatus: 'DELIVERED',
          etaAt: eta,
        },
        new Date('2026-10-02T09:00:00+05:30'),
      ),
    ).toBeNull();
    expect(
      confirmMode(
        {
          orderStatus: 'DELIVERED',
          hasReceipt: false,
          stopStatus: 'DELIVERED',
          etaAt: eta,
        },
        new Date('2026-10-03T09:00:00+05:30'),
      ),
    ).toBe('NORMAL');
  });
});
