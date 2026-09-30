# apps/frontend

React 19 + Vite PWA, React Router 7 (data routers), TanStack Query 5, Tailwind 4 and shadcn/ui
themed with Compass tokens.

## Rules
- Data comes only from generated hooks in @compass/api-client. No hand-written fetch.
- Actions render with <Action link={res._links.submit} />. No link, no button. Never re-check roles
  in components.
- Forms use react-hook-form with the generated zod schema; applyProblem(form, problem) maps a
  problem's errors[] onto fields.
- Build from the Compass components in src/ui (Button, Badge, Input, Select, Table, Pagination,
  Dialog, Sheet, Toast, StatusChip, CapacityMeter, DeliveryWindow, StopSequenceRow, DriverStopCard,
  PinKeypad). Tokens only; dock and driver shells set data-density="touch" (44 px targets).
- Time: useServerClock() and formatColombo().
- Realtime: useEventStream (src/realtime) invalidates query keys as events arrive; only vehicle
  positions patch the cache directly.
- Driver and loader screens write through outbox.enqueue(type, payload), which updates Dexie first,
  and read with useLiveQuery. They never call mutation hooks directly (see the offline-action skill).
- MSW runs in development; add a path to src/mocks/live.ts once its endpoint is real.

## Screens
src/app/routes/<role>.tsx registers a role's routes and loaders. Each frame is one file in
src/features/<module>/ (dialogs and states in their own files) that names its frame at the top:
// Figma: D4 Record stop · 185:20174
Frames, nodes, routes and endpoints are in specs/frontend/screens.md. Use the react-screen skill,
then /fidelity <frame code> before you say the screen is done.
