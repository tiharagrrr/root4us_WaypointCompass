import { defineConfig } from 'tsup';

export default defineConfig({
  // domain.ts is also its own entry: the web app imports the vocabulary (depots, statuses) from
  // @waypoint/shared/domain and so leaves zod and better-auth out of its bundle.
  entry: ['src/index.ts', 'src/domain.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // better-auth ships only ES modules. Bundling its access-control helpers
  // keeps the CommonJS build loadable by the API's Jest.
  noExternal: [/^better-auth/, /^@better-auth/],
});
