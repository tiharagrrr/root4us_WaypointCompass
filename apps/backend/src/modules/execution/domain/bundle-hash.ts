import { createHash } from 'node:crypto';

/**
 * The bundle's hash: sha256 over its body with object keys in a fixed order,
 * so the same trip hashes the same way twice and any change to what the
 * driver would see changes it (AC-EXE-04).
 *
 * The trip's `version` is the bundle's version, because that is the number
 * If-Match and the changes feed already speak in. The hash is the finer
 * check: planning bumps the trip's version when it resequences or reassigns,
 * but an edit to an outlet's access note or an order's lines does not touch
 * the trip row at all, and the phone must still notice. D2 compares the
 * hash; the version is what `POST /trips/{id}/downloaded` records.
 *
 * `generatedAt` is deliberately left out of the body that is hashed — it
 * changes on every call and would make every download look new.
 */
export function bundleHash(body: unknown): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

/** JSON with object keys sorted, so key order cannot change the hash. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
