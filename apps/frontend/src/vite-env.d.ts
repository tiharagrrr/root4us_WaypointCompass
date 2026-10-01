/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin prefixed to API requests; empty for same-origin (see .env.example). */
  readonly VITE_API_BASE?: string
  /** "off" disables the Mock Service Worker in development. */
  readonly VITE_MSW?: string
}
