import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/app-config';
import { setupOpenApi } from './core/http/openapi';

async function bootstrap() {
  // BetterAuth parses its own request bodies (see app.setup.ts); logs made
  // while Nest boots are held until pino takes over.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app);
  app.enableShutdownHooks();
  setupOpenApi(app);

  const port = app.get(AppConfig).port;
  await app.listen(port);
  app
    .get(Logger)
    .log(`API listening on :${port} (docs at /api/docs)`, 'Bootstrap');
}
void bootstrap();
