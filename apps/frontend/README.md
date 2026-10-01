# @waypoint/frontend

React 19 + Vite PWA with one app and role-based routes:

| Route | Role | Primary device |
| --- | --- | --- |
| `/dispatch` | Dispatcher | Desktop, large screen |
| `/load` | Loader | Shared dock tablet (phone width is judged) |
| `/drive` | Driver | Personal phone, offline-capable |
| `/store` | Store manager | Desktop or phone |
| `/admin` | Admin | Desktop |

`pnpm dev` serves on http://localhost:5173 and proxies `/api` to the API on `:3000`. In Docker, Caddy serves the build and proxies `/api` (see `deploy/caddy/Caddyfile`).

Layout: `src/app` (router, shells, `routes/<role>.tsx`), `src/features/<module>` (one file per Figma frame), `src/ui` (Compass components on Tailwind 4 and Radix, themed only by `@compass/ui-tokens`), `src/lib` (time, links, form helpers) and `src/mocks` (MSW: every endpoint not in `live.ts` is mocked in dev). Data comes from the orval-generated hooks in `@compass/api-client`; `pnpm api:gen` regenerates them. `/admin/dev/ui` shows every component in development.

Still to come from the spec: `vite-plugin-pwa` (Workbox) and Dexie for the offline outbox.
