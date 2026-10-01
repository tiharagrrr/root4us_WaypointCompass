import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { LinkDto, MetaDto, ProblemDto } from './api.dto';
import { API_VERSION } from './envelope.interceptor';

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The OpenAPI document, the contract orval turns into hooks, zod schemas and
 * MSW mocks. Operation ids read as `<resource><Method>` (OrdersController.list
 * becomes ordersList, so the hook is useOrdersList).
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Waypoint Compass API')
    .setDescription(
      'Delivery planning for Waypoint Group (Tech Triathlon 2026). Conventions: specs/api-conventions.md.',
    )
    .setVersion(API_VERSION)
    .addCookieAuth('__Secure-better-auth.session_token')
    .build();
  return SwaggerModule.createDocument(app, config, {
    extraModels: [LinkDto, MetaDto, ProblemDto],
    operationIdFactory: (controllerKey, methodKey) =>
      `${lowerFirst(controllerKey.replace(/Controller$/, ''))}${upperFirst(methodKey)}`,
  });
}

/** Swagger UI at /api/docs and the JSON at /api/docs/openapi.json. */
export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: 'api/docs/openapi.json',
  });
}
