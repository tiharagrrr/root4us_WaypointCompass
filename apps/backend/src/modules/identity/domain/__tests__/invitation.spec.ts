import { effectiveStatus, hashToken } from '../invitation';

describe('effectiveStatus', () => {
  const expiresAt = new Date('2026-10-03T09:00:00+05:30');

  it('reads a PENDING invitation as EXPIRED from its expiry on', () => {
    const pending = { status: 'PENDING' as const, expiresAt };
    expect(
      effectiveStatus(pending, new Date('2026-10-03T08:59:59+05:30')),
    ).toBe('PENDING');
    expect(effectiveStatus(pending, expiresAt)).toBe('EXPIRED');
  });

  it('leaves ACCEPTED and REVOKED as they are', () => {
    const late = new Date('2026-10-04T00:00:00+05:30');
    expect(effectiveStatus({ status: 'ACCEPTED', expiresAt }, late)).toBe(
      'ACCEPTED',
    );
    expect(effectiveStatus({ status: 'REVOKED', expiresAt }, late)).toBe(
      'REVOKED',
    );
  });
});

describe('hashToken', () => {
  it('stores a sha256 hex digest, never the token', () => {
    const hash = hashToken('token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('token');
  });
});
