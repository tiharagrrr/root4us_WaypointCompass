import { Logger, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Caddy serves the web app and proxies /api to this service on one origin,
  // so no CORS is needed. Probes and Prometheus hit /health and /metrics.
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('Waypoint API')
    .setDescription(
      'Delivery planning for Waypoint Group (Tech-Triathlon 2026)',
    )
    .setVersion('1')
    .addCookieAuth('better-auth.session_token')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    () => SwaggerModule.createDocument(app, openApi),
    {
      jsonDocumentUrl: 'api/docs/openapi.json',
    },
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API listening on :${port} (docs at /api/docs)`, 'Bootstrap');
}
void bootstrap();
