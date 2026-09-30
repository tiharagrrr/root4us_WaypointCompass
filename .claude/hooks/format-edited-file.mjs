// .claude/hooks/format-edited-file.mjs: formats whatever the agent just edited
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const file = JSON.parse(input).tool_input?.file_path;
const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

const formattable = /\.(ts|tsx|js|mjs|cjs|json|md|css|ya?ml)$/;
// Generated or lock files are never reformatted.
const skipped = /(\/gen\/|\/drizzle\/meta\/|openapi\.json$|pnpm-lock\.yaml$)/;

if (file && formattable.test(file) && !skipped.test(file) && resolve(file).startsWith(root + sep)) {
  // Use the prettier of the nearest package that has one (the root, once packages/config lands).
  let dir = dirname(resolve(file));
  while (dir.startsWith(root) && !existsSync(join(dir, 'node_modules/.bin/prettier'))) dir = dirname(dir);
  const prettier = join(dir, 'node_modules/.bin/prettier');

  if (dir.startsWith(root) && existsSync(prettier)) {
    try {
      execFileSync(prettier, ['--write', '--log-level=silent', file], { cwd: dir, stdio: 'ignore', timeout: 15000 });
    } catch {
      // formatting never blocks the agent; pnpm check catches the rest
    }
  }
}
