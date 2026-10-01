/**
 * Writes apps/backend/openapi.json, the contract orval generates the web
 * client from. It builds the app in preview mode (nothing is instantiated,
 * nothing connects), so it needs no database or Redis:
 *
 *   pnpm --filter api openapi:write      (nest build, then this file from dist)
 *
 * Run from dist so the @nestjs/swagger CLI plugin has annotated the DTOs.
 */
import './openapi.env';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { buildOpenApiDocument } from './core/http/openapi';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    preview: true,
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  configureApp(app);
  const document = buildOpenApiDocument(app);
  const target = resolve(__dirname, '../openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(
    `[openapi] ${Object.keys(document.paths).length} paths written to ${target}`,
  );
}

void main();
