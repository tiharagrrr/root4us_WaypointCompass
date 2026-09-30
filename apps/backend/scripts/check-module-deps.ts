/**
 * Module boundaries (CLAUDE.md, architecture rule 1), run by `pnpm check` and CI:
 *
 *   - every folder in src/modules has specs/<module>/spec.md and is registered in src/app.module.ts
 *   - a module imports another module only through that module's index.ts
 *   - and only a module named in the depends-on line of its own spec
 *   - nothing in src/core imports a module
 *
 *   pnpm --filter api check:boundaries
 *
 * The spec's depends-on line is the allowed-imports table: change it there, in the same PR as the
 * import. `core` and `engine` (packages/engine) are not modules and are ignored.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(__dirname, '..');
const SRC = join(ROOT, 'src');
const MODULES = join(SRC, 'modules');
const SPECS = resolve(ROOT, '../../specs');
const NOT_MODULES = new Set(['core', 'engine']);

interface Import {
  file: string;
  line: number;
  target: string; // absolute path, without extension
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** Relative and baseUrl ('src/...') imports, re-exports and dynamic imports in a file. */
function importsOf(file: string): Import[] {
  const text = readFileSync(file, 'utf8');
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]((?:\.{1,2}|src)\/[^'"]*)['"]/g;
  return [...text.matchAll(pattern)].map((m) => ({
    file,
    line: text.slice(0, m.index).split('\n').length,
    target: m[1].startsWith('src/')
      ? resolve(ROOT, m[1])
      : resolve(dirname(file), m[1]),
  }));
}

/** The module a path lies in, and the rest of the path inside it. */
function moduleOf(path: string): { name: string; rest: string[] } | null {
  const rel = relative(MODULES, path);
  if (rel.startsWith('..') || rel === '') return null;
  const [name, ...rest] = rel.split(sep);
  return { name, rest };
}

function dependsOn(module: string): Set<string> | null {
  const file = join(SPECS, module, 'spec.md');
  if (!existsSync(file)) return null;
  const match = readFileSync(file, 'utf8').match(
    /^depends-on:\s*\[([^\]]*)\]/m,
  );
  const names = (match?.[1] ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s && !NOT_MODULES.has(s));
  return new Set(names);
}

const problems: string[] = [];
const at = (i: Import) => `${relative(ROOT, i.file)}:${i.line}`;

const modules = existsSync(MODULES)
  ? readdirSync(MODULES).filter((n) => statSync(join(MODULES, n)).isDirectory())
  : [];
const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
let checked = 0;

for (const module of modules) {
  const allowed = dependsOn(module);
  if (allowed === null) {
    problems.push(
      `src/modules/${module}: no specs/${module}/spec.md (see the nest-module skill)`,
    );
    continue;
  }
  if (!existsSync(join(MODULES, module, 'index.ts'))) {
    problems.push(`src/modules/${module}: no index.ts`);
  }
  if (!appModule.includes(`'./modules/${module}'`)) {
    problems.push(`src/modules/${module}: not imported in src/app.module.ts`);
  }
  for (const i of walk(join(MODULES, module)).flatMap(importsOf)) {
    const target = moduleOf(i.target);
    if (!target || target.name === module) continue;
    checked++;
    const viaIndex =
      target.rest.length === 0 ||
      (target.rest.length === 1 && /^index(\.[jt]s)?$/.test(target.rest[0]));
    if (!viaIndex) {
      problems.push(
        `${at(i)}  ${module} reaches into ${target.name}/${target.rest.join('/')}; import from '${target.name}' (its index.ts)`,
      );
    }
    if (!allowed.has(target.name)) {
      problems.push(
        `${at(i)}  ${module} may not import ${target.name}: add it to depends-on in specs/${module}/spec.md, or use an event`,
      );
    }
  }
}

for (const i of walk(join(SRC, 'core')).flatMap(importsOf)) {
  const target = moduleOf(i.target);
  if (target)
    problems.push(`${at(i)}  core may not import a module (${target.name})`);
}

if (problems.length > 0) {
  console.error(
    `[boundaries] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`,
  );
  process.exit(1);
}
console.log(
  `[boundaries] ${modules.length} modules, ${checked} cross-module imports, all through index.ts and allowed by depends-on`,
);
