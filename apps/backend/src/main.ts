import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // BetterAuth parses its own request bodies (see app.setup.ts).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle('Waypoint API')
    .setDescription(
      'Delivery planning for Waypoint Group (Tech-Triathlon 2026)',
    )
    .setVersion('1')
    .addCookieAuth('__Secure-better-auth.session_token')
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
