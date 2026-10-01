import { canonicalJson, chainHash, GENESIS_HASH } from '../hash-chain';

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined members', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [2, null], c: 'x' }, e: undefined }),
    ).toBe('{"a":{"c":"x","d":[2,null]},"b":1}');
  });

  it('writes dates as ISO 8601', () => {
    expect(canonicalJson({ at: new Date('2026-10-01T10:00:00+05:30') })).toBe(
      '{"at":"2026-10-01T04:30:00.000Z"}',
    );
  });
});

describe('chainHash', () => {
  it('changes when the previous hash or any field changes', () => {
    const row = { action: 'identity.user.role_changed', entityId: 'u1' };
    const first = chainHash(GENESIS_HASH, row);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(chainHash(GENESIS_HASH, { ...row })).toBe(first);
    expect(chainHash(first, row)).not.toBe(first);
    expect(chainHash(GENESIS_HASH, { ...row, entityId: 'u2' })).not.toBe(first);
  });
});
