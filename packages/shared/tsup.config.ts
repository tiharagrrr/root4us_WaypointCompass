import { defineConfig } from 'tsup';

export default defineConfig({
  // domain.ts and business-time.ts are also their own entries. Both are pure and import nothing, so
  // the web app (and the engine) take the vocabulary and the business-date maths from
  // @waypoint/shared/domain and @waypoint/shared/business-time and leave zod and better-auth out.
  entry: {
    index: 'src/index.ts',
    domain: 'src/domain.ts',
    'business-time': 'src/rules/business-time.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // better-auth ships only ES modules. Bundling its access-control helpers
  // keeps the CommonJS build loadable by the API's Jest.
  noExternal: [/^better-auth/, /^@better-auth/],
});
