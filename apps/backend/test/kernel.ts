import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { ClockService } from '../src/core/clock/clock.service';
import type { Problem } from '../src/core/http/problem-details.filter';

/** Stops the demo clock for a test: freezeClock(app, '2026-10-01T15:59:00+05:30'). Undo with clock.reset(). */
export function freezeClock(app: INestApplication, at: string): ClockService {
  const clock = app.get(ClockService);
  clock.freeze(at);
  return clock;
}

/** Checks a problem+json response and returns the problem for further checks. */
export function expectProblem(res: Response, code: string): Problem {
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  const problem = res.body as Problem;
  expect(problem).toMatchObject({ code, status: res.status });
  expect(typeof problem.requestId).toBe('string');
  return problem;
}
