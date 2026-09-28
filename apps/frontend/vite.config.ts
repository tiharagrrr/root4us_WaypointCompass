import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    port: 5173,
    // Same-origin in dev too: /api goes to the Nest API, like Caddy in Docker.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
