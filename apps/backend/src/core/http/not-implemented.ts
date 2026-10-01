import { NotImplementedException } from '@nestjs/common';

/**
 * A contract-first route: its path, permission, headers and response shape are final and in
 * openapi.json, and its service lands in the next PR. Screens build against the generated MSW
 * mocks until then (specs/api-conventions.md, the contract-first skill).
 *
 *   create(@Body() dto: CreateOrderDto, @Actor() actor: Actor) {
 *     return notImplemented('POST /orders', { dto, actor });
 *   }
 *
 * `received` names the inputs the route already validates, so a caller can see from the 501 what
 * reached the handler. It never carries their values: an actor and an order hold personal data.
 */
export function notImplemented(
  route: string,
  received: Record<string, unknown> = {},
): never {
  const inputs = Object.keys(received).join(', ');
  throw new NotImplementedException(
    inputs
      ? `${route} is not implemented yet. It accepts: ${inputs}.`
      : `${route} is not implemented yet.`,
  );
}
