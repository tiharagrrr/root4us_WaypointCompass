---
description: Compare a built screen with its Figma frame at the frame's size, then fix or log the differences
argument-hint: <frame code, e.g. M1 or D4>
---
Check screen $0 against its Figma frame.

1. Look up $0 in specs/frontend/screens.md: Figma node, viewport, route, role and endpoints.
2. Fetch the design through the Figma MCP: get_screenshot and get_design_context with file
   F22bpXWBPLlXkXwA89XHfQ and the node id. If the MCP is not connected, ask me to run /mcp.
3. Screenshot the built route at the frame's viewport (1440x960 desktop, 1194x834 tablet, 390x844
   phone) with Playwright, signed in as the frame's role, into `.fidelity/$0.png` (git-ignored).
   Use the dev server (`pnpm dev`) or the Playwright helpers in apps/frontend if they exist, for example
   `pnpm --filter frontend exec playwright screenshot --viewport-size=390,844 --load-storage=<role state> <url> .fidelity/$0.png`.
   Capture the loading, empty, error and (driver and loader) offline states too where you can
   trigger them through MSW.
4. Compare side by side and list differences under: layout and spacing, copy (word for word),
   tokens (colour, type, radius; no hex values), components, states, and actions shown (each must
   come from a _links entry).
5. Fix what should match. Log each intended difference in docs/departures.md (create it with the
   header `| Screen | Designed | Built | Why |` if missing).
6. Reply with a table of difference → fixed or logged, and the screenshot paths.
