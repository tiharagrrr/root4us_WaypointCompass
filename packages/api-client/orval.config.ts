import { defineConfig } from 'orval';
import { dropMistypedExamples } from './scripts/drop-mistyped-examples.ts';

/**
 * Generates the Compass client from the API's OpenAPI document (specs/api-conventions.md, section 9).
 * Run `pnpm api:gen` from the repo root: it writes apps/backend/openapi.json, then runs this.
 * Everything under src/gen is generated: never edit it by hand.
 */
export default defineConfig({
  compass: {
    input: {
      target: '../../apps/backend/openapi.json',
      override: { transformer: dropMistypedExamples },
    },
    output: {
      mode: 'tags-split',
      target: 'src/gen/endpoints',
      schemas: 'src/gen/model',
      client: 'react-query',
      httpClient: 'fetch',
      // If-Match and Idempotency-Key become typed parameters once the API declares them.
      headers: true,
      indexFiles: true,
      clean: true,
      mock: {
        indexMockFiles: true,
        generators: [{ type: 'msw', delay: 300, useExamples: true }],
      },
      override: {
        mutator: { path: 'src/mutator.ts', name: 'compassFetch' },
        // Hooks return the response body itself: the { data, meta, _links } envelope.
        fetch: { includeHttpResponseReturnType: false },
        query: { signal: true },
      },
    },
  },
  compassZod: {
    input: { target: '../../apps/backend/openapi.json' },
    output: {
      mode: 'tags-split',
      client: 'zod',
      target: 'src/gen/zod',
      fileExtension: '.zod.ts',
      indexFiles: true,
      clean: true,
    },
  },
});
