import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw, type NextFunction, type Request, type Response } from 'express';
import { PayloadTooLargeError } from './core/errors/domain-errors';
import { toProblem } from './core/http/problem-details.filter';
import { validationPipe } from './core/http/validation';

export const API_PREFIX = 'api/v1';
/** Routes served outside /api/v1: probes and Prometheus. */
export const UNPREFIXED_ROUTES = ['health', 'health/live', 'metrics'];
/** Inbound webhooks are read raw, so their signatures can be checked. */
export const WEBHOOKS_PATH = `/${API_PREFIX}/webhooks`;
const WEBHOOK_BODY_LIMIT = '1mb';

/**
 * HTTP settings shared by main.ts and the e2e tests. Create the app with
 * { bodyParser: false }: BetterAuth reads its own bodies, and AuthModule
 * re-adds the JSON parser for every other route.
 */
export function configureApp(app: NestExpressApplication): void {
  // Before any Nest middleware, so BetterAuth's JSON parser finds the body
  // already read and leaves it as a Buffer.
  app.use(WEBHOOKS_PATH, webhookBody);
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

const rawParser = raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT });

/** The raw parser, answering problem+json itself: its errors never reach Nest's filters. */
function webhookBody(req: Request, res: Response, next: NextFunction): void {
  rawParser(req, res, (err?: unknown) => {
    if (!err) return next();
    const tooLarge = (err as { type?: unknown }).type === 'entity.too.large';
    const problem = toProblem(tooLarge ? new PayloadTooLargeError() : err, req);
    res.status(problem.status).type('application/problem+json').json(problem);
  });
}
