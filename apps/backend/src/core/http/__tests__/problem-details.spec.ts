import { NotFoundException } from '@nestjs/common';
import { assertTransition, orderMachine } from '@waypoint/shared';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CutoffPassedError,
  RateLimitedError,
  RuleViolationError,
  VersionMismatchError,
} from '../../errors/domain-errors';
import { toProblem } from '../problem-details.filter';

const req = {
  originalUrl: '/api/v1/orders/0192/submit',
  headers: { 'x-request-id': 'req-1' },
} as unknown as Request;

const catching = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
};

describe('problem+json', () => {
  it('renders a domain error with its code, status, detail and the request id', () => {
    expect(
      toProblem(new CutoffPassedError('Orders close at 16:00.'), req),
    ).toEqual({
      type: 'https://compass.waypoint.lk/problems/cutoff-passed',
      title: 'The cutoff has passed',
      status: 409,
      code: 'CUTOFF_PASSED',
      detail: 'Orders close at 16:00.',
      instance: '/api/v1/orders/0192/submit',
      requestId: 'req-1',
    });
    expect(toProblem(new VersionMismatchError('order'), req)).toMatchObject({
      status: 412,
      code: 'VERSION_MISMATCH',
    });
  });

  it('carries rule violations and their fix links', () => {
    const err = new RuleViolationError(
      [
        {
          rule: 'CAP_VOLUME',
          severity: 'HARD',
          message: 'Over volume by 0.42 m³',
        },
      ],
      'Moving WF-0171 onto REF-07 trip 1 exceeds its volume.',
      { fixes: { href: '/api/v1/plans/1/suggest-fixes', method: 'POST' } },
    );
    expect(toProblem(err, req)).toMatchObject({
      status: 422,
      code: 'PLAN_RULE_VIOLATION',
      violations: [{ rule: 'CAP_VOLUME' }],
      _links: { fixes: { href: '/api/v1/plans/1/suggest-fixes' } },
    });
  });

  it('answers 409 CONFLICT_STATE for a refused state machine transition', () => {
    const err = catching(() =>
      assertTransition(orderMachine, 'CANCELLED', 'SUBMIT'),
    );
    expect(toProblem(err, req)).toMatchObject({
      status: 409,
      code: 'CONFLICT_STATE',
    });
  });

  it('turns zod issues into field errors', () => {
    const parsed = z
      .object({ lines: z.array(z.object({ qty: z.number().min(1) })) })
      .safeParse({ lines: [{ qty: 1 }, { qty: 0 }] });
    expect(toProblem(parsed.error, req)).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'lines[1].qty', code: 'too_small' }],
    });
  });

  it("maps Nest's HTTP errors and Postgres's constraint errors", () => {
    expect(toProblem(new NotFoundException(), req)).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
    const unique = { cause: { code: '23505', constraint: 'orders_no_key' } };
    expect(toProblem(unique, req)).toMatchObject({
      status: 409,
      code: 'CONFLICT_STATE',
    });
    const check = { cause: { code: '23514', constraint: 'qty_positive' } };
    expect(toProblem(check, req)).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'The value breaks the qty_positive rule.',
    });
    const rls = { code: '42501' };
    expect(toProblem(rls, req)).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('hides the details of an unexpected error', () => {
    const problem = toProblem(new Error('password=hunter2 at db.ts:12'), req);
    expect(problem).toEqual({
      type: 'https://compass.waypoint.lk/problems/internal',
      title: 'Something went wrong',
      status: 500,
      code: 'INTERNAL',
      instance: '/api/v1/orders/0192/submit',
      requestId: 'req-1',
    });
  });

  it('gives Retry-After with a rate limit', () => {
    expect(new RateLimitedError(30).headers()).toEqual({ 'Retry-After': '30' });
  });
});
