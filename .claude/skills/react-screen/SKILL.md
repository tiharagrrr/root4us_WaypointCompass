---
name: react-screen
description: Build or update a screen in apps/frontend from its Figma frame, wired to generated API hooks,
  server-driven actions and the Compass design system. Use for any new route, dialog or screen state.
---

# Build a screen from Figma

## Inputs
- The frame code (for example M4): look it up in specs/frontend/screens.md for its Figma node,
  route, endpoints and owner.
- The module spec's acceptance criteria.

## Steps
1. Look. Call the Figma MCP get_design_context with file F22bpXWBPLlXkXwA89XHfQ and the node id
   (load the figma-design-to-code guidance first if it is installed). Note layout, components, copy
   and states, and check neighbouring frames for variants (L3a to L3c, M1 and M1b). If the Figma MCP
   is not connected, ask the person to run /mcp and sign in; do not guess the design.
2. Map to Compass. Use components from src/ui and tokens from @compass/ui-tokens. If a Figma
   component has no React twin, build it in src/ui first: one component, its variants, a story.
3. Route. Register it in src/app/routes/<role>.tsx with a loader that prefetches the main query.
   The screen itself is one file per frame in src/features/<module>/ (dialogs and states in their
   own files), each starting with // Figma: <code> <name> · <node>.
4. Data. Generated hooks only. Until the endpoint is live MSW serves it; never mock in components.
5. Actions. Every button comes from _links through <Action>; confirm destructive actions; show a
   reason picker wherever the action needs a reason.
6. States. Loading skeletons that match the layout, empty, error (problem detail and retry), the
   offline banner on driver and loader screens, and live updates through useEventStream.
7. Viewport. Check at the frame's size: 1440x960 desktop, 1194x834 tablet, 390x844 phone.
8. Copy. Use the Figma copy word for word, in src/i18n/en.json.
9. Test. A component test for the main interaction; add the screen to the Playwright walkthrough if
   it is on the judge path.
10. Fidelity. Run /fidelity <code>: screenshot at the frame's size, compare it with the Figma
    screenshot side by side, and log any intended difference in docs/departures.md.

## Checklist
- [ ] // Figma: header on the route file
- [ ] No hand-written fetch, no hex values, no role checks in components
- [ ] Every action button backed by a _links entry
- [ ] Loading, empty, error (and offline for driver and loader) states built
- [ ] Checked at the frame's viewport; departures logged
- [ ] Driver and loader writes go through the outbox (offline-action skill)
