import { createHash } from 'node:crypto';

/** prevHash of the first audit row. */
export const GENESIS_HASH = '0'.repeat(64);

export const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * JSON with object keys sorted by UTF-16 code unit and no whitespace (RFC
 * 8785 for the values an audit row holds), so the same row always hashes the
 * same. Dates become ISO 8601 strings; undefined members are left out.
 */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const members = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** hash = sha256(prevHash + canonical row), the link that makes the trail tamper-evident. */
export const chainHash = (prevHash: string, row: object): string =>
  sha256(prevHash + canonicalJson(row));
