---
description: Run pnpm check, fix failures in the files this branch touched, report the rest
---
1. Run `pnpm check` (lint, typecheck, module boundaries, tests).
2. Find the files this branch touched: `git diff --name-only main...HEAD` plus `git status --short`.
3. Fix failures in those files at the root cause. Use the debug skill when the cause is not obvious.
4. Leave failures in files this branch did not touch alone; report them with the first error line.
5. Run `pnpm check` again until the touched files are clean.
6. Reply with: pass or fail per step (lint, typecheck, boundaries, tests), what you fixed, and what
   is left with its owner if you can tell from the spec frontmatter.

Never make it pass by skipping, deleting or loosening a test, adding eslint-disable or @ts-ignore,
adding `any`, or relaxing the boundaries config.
