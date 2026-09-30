import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // better-auth ships only ES modules. Bundling its access-control helpers
  // keeps the CommonJS build loadable by the API's Jest.
  noExternal: [/^better-auth/, /^@better-auth/],
});
