import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule, type Params } from 'nestjs-pino';
import { AppConfig } from '../../config/app-config';
import {
  correlationIdOf,
  deviceIdOf,
  ensureRequestId,
} from '../context/request-context';

/**
 * Paths never logged: credentials, one-time codes and personal data. Every
 * object key named like these is replaced at any of the first two levels.
 */
export const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  ...[
    'password',
    'pin',
    'code',
    'otp',
    'token',
    'phoneNumber',
    'email',
  ].flatMap((key) => [`${key}`, `*.${key}`]),
  'receiverName',
  '*.receiverName',
];

/**
 * One JSON line per event, with app, env, version, reqId, correlationId,
 * deviceId and (once ActorGuard has run) actor on every line of a request,
 * and one access line per request. Health checks and /metrics are not logged.
 */
export const AppLoggerModule = LoggerModule.forRootAsync({
  providers: [AppConfig],
  inject: [AppConfig],
  useFactory: (cfg: AppConfig): Params => ({
    // ActorGuard's assign({ actor }) also reaches the access line.
    assignResponse: true,
    pinoHttp: {
      level: cfg.log.level,
      transport: cfg.isDev
        ? { target: 'pino-pretty', options: { singleLine: true } }
        : undefined,
      base: { app: cfg.appName, env: cfg.env, version: cfg.version },
      genReqId: (req: IncomingMessage) => ensureRequestId(req),
      // Service log lines carry reqId rather than the whole request.
      quietReqLogger: true,
      customProps: (req: IncomingMessage) => ({
        correlationId: correlationIdOf(req),
        deviceId: deviceIdOf(req),
      }),
      customLogLevel: (_req, res: ServerResponse, err?: Error) =>
        err || res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'info',
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      serializers: {
        req: (req: { method?: string; url?: string }) => ({
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode?: number }) => ({
          statusCode: res.statusCode,
        }),
      },
      autoLogging: {
        ignore: (req: IncomingMessage) =>
          !!req.url?.startsWith('/health') || req.url === '/metrics',
      },
    },
  }),
});
