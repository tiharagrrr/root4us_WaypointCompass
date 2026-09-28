# @waypoint/frontend

React 19 + Vite PWA with one app and role-based routes:

| Route | Role | Primary device |
| --- | --- | --- |
| `/dispatch` | Dispatcher | Desktop, large screen |
| `/load` | Loader | Shared dock tablet (phone width is judged) |
| `/drive` | Driver | Personal phone, offline-capable |
| `/store` | Store manager | Desktop or phone |

`pnpm dev` serves on http://localhost:5173 and proxies `/api` to the API on `:3000`. In Docker, Caddy serves the build and proxies `/api` (see `deploy/caddy/Caddyfile`).

Planned additions from the spec: Tailwind + shadcn/ui (or Mantine), `vite-plugin-pwa` (Workbox), Dexie for the offline outbox, and an orval-generated API client.
