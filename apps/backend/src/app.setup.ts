import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { validationPipe } from './core/http/validation';

export const API_PREFIX = 'api/v1';
/** Routes served outside /api/v1: probes and Prometheus. */
export const UNPREFIXED_ROUTES = ['health', 'health/live', 'metrics'];

/**
 * HTTP settings shared by main.ts and the e2e tests. Create the app with
 * { bodyParser: false }: BetterAuth reads its own bodies, and AuthModule
 * re-adds the JSON parser for every other route.
 */
export function configureApp(app: NestExpressApplication): void {
  // Nest 11 on Express 5 parses ?filter[status]=A flat unless told otherwise.
  app.set('query parser', 'extended');
  // Caddy serves the web app and proxies /api to this service on one origin,
  // so no CORS is needed. Probes and Prometheus hit /health and /metrics.
  app.setGlobalPrefix(API_PREFIX, {
    exclude: UNPREFIXED_ROUTES.map((path) => ({
      path,
      method: RequestMethod.GET,
    })),
  });
  app.useGlobalPipes(validationPipe());
}
