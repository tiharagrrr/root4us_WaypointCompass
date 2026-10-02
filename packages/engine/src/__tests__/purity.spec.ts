import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkPurity } from './purity-check';

const ENGINE_ROOT = join(__dirname, '../..');
const SRC = join(ENGINE_ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('the engine stays pure (an allowlist, so it fails closed)', () => {
  it('purity: the engine has source files to check', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(20);
  });

  it('purity: every import and every global in src is on the allowlist', () => {
    // Each entry reads "file:line:col what is wrong", so a failure names the exact line.
    expect(checkPurity(sourceFiles(SRC), ENGINE_ROOT)).toEqual([]);
  }, 30_000);
});

describe('the guard itself refuses what it should', () => {
  const dir = mkdtempSync(join(tmpdir(), 'engine-purity-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const check = (name: string, source: string) => {
    const file = join(dir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, source);
    return checkPurity([file], ENGINE_ROOT, dir).map((p) => p.replace(`${name}:`, 'file:'));
  };

  it('purity: refuses an import that is not on the allowlist, and says which', () => {
    expect(check('a.ts', "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n")).toEqual([
      'file:1:1 imports "node:fs", which is not on the allowlist (allowed: zod, @waypoint/shared/domain, @waypoint/shared/business-time, or a relative path)',
    ]);
  });

  it('purity: refuses the root of @waypoint/shared; only its two pure entry points are allowed', () => {
    const [problem] = check('b.ts', "import { can } from '@waypoint/shared';\nexport const x = can;\n");
    expect(problem).toContain('imports "@waypoint/shared", which is not on the allowlist');
  });

  it('purity: refuses a re-export from an unlisted package', () => {
    const [problem] = check('c.ts', "export { z } from 'some-package';\n");
    expect(problem).toContain('imports "some-package"');
  });

  it('purity: refuses require() and dynamic import()', () => {
    const problems = check('d.ts', "declare const require: (m: string) => unknown;\nexport const a = require('x');\nexport const b = import('y');\n");
    expect(problems).toEqual([
      'file:2:18 calls require(), which hides what the engine depends on',
      'file:3:18 uses a dynamic import(), which hides what the engine depends on',
    ]);
  });

  it('purity: refuses the clock, however it is reached', () => {
    expect(check('e.ts', 'export const a = Date.now();\nexport const b = new Date();\n')).toEqual([
      'file:1:18 uses the global "Date", which is not on the allowlist',
      'file:2:22 uses the global "Date", which is not on the allowlist',
    ]);
  });

  it('purity: refuses Math.random but allows the rest of Math', () => {
    expect(check('f.ts', 'export const a = Math.random();\nexport const b = Math.round(1.5);\n')).toEqual([
      'file:1:18 uses Math.random, which is not deterministic',
    ]);
  });

  it('purity: refuses process, Buffer, fetch, timers and console, none of which it lists', () => {
    const problems = check(
      'g.ts',
      "export const a = process.env;\nexport const b = Buffer.from('x');\nexport const c = fetch;\nexport const d = setTimeout;\nexport const e = console.log;\n",
    );
    expect(problems.map((p) => /"(\w+)"/.exec(p)?.[1])).toEqual(['process', 'Buffer', 'fetch', 'setTimeout', 'console']);
  });

  it('purity: allows relative imports, listed packages and the listed globals', () => {
    expect(
      check(
        'h.ts',
        "import { z } from 'zod';\nimport { dowOf } from '@waypoint/shared/business-time';\nimport { x } from './other';\nexport const a = [z, dowOf, x, new Map(), Object.keys({}), String(1), Math.max(1, 2), new Error('e')];\n",
      ),
    ).toEqual([]);
  });

  it('purity: refuses a name it cannot resolve, so a missing type root cannot let a global through', () => {
    const file = join(dir, 'j.ts');
    writeFileSync(file, 'export const a = process.env;\n');
    expect(checkPurity([file], dir, dir)).toEqual([
      'j.ts:1:18 uses "process", which cannot be resolved, so it cannot be shown to be pure',
    ]);
  });

  it('purity: does not mistake a property called Date for the global', () => {
    expect(check('i.ts', 'export const a = { Date: 1 };\nexport const b = a.Date;\n')).toEqual([]);
  });
});
