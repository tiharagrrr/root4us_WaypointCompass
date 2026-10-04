import type { NestExpressApplication } from '@nestjs/platform-express';
import { MAX_TRIPS_PER_VEHICLE_PER_DAY } from '@waypoint/shared';
import request from 'supertest';
import { bodyOf, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import {
  depotFixture,
  outletFixture,
  suffix,
  vehicleFixture,
} from '../../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import type { Database } from '../../../db/client';
import { demandForecasts } from '../../../db/schema';
import type { DepotForecastDto } from '../dto/forecast.dto';

/** Thu 1 Oct 2026 is in ISO week 40, so the ten weeks ahead are 41 to 50. */
const AT = '2026-10-01T10:00:00+05:30';
const WEEKS = [41, 42, 43, 44, 45, 46, 47, 48, 49, 50];
/** The one week whose forecast is far more than two trucks can carry. */
const GAP_WEEK = 44;

/**
 * 22's read: ten weeks of forecast volume against the fleet's capacity
 * (specs/forecasting/spec.md). Forecast rows are hand-built, never dataset rows.
 */
describeWithDb('forecasting: weeks ahead against capacity', () => {
  jest.setTimeout(120_000);

  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  const sfx = suffix();
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  const cookies: Record<string, string> = {};

  const get = (who: string, path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Cookie', cookies[who]);

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    const outletId = await outletFixture(db, `OUTF${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    // Two ambient trucks of 20 m³ each (vehicleFixture); no reefer.
    await vehicleFixture(db, `DRY-FA${sfx}`, depot.plg);
    await vehicleFixture(db, `DRY-FB${sfx}`, depot.plg);
    await db.insert(demandForecasts).values(
      WEEKS.map((isoWeek) => ({
        depotId: depot.plg,
        brand: 'STYLE' as const,
        isoYear: 2026,
        isoWeek,
        totalVolumeM3: isoWeek === GAP_WEEK ? 5000 : 12,
        chilledVolumeM3: 0,
        source: 'DATATHON' as const,
        modelVersion: 'test-1',
      })),
    );

    for (const [key, input] of [
      ['admin', { role: 'admin' as const }],
      ['dispatcher', { role: 'dispatcher' as const, depotId: depot.plg }],
      ['kandy', { role: 'dispatcher' as const, depotId: depot.kdy }],
      ['loader', { role: 'loader' as const, depotId: depot.plg }],
      ['driver', { role: 'driver' as const, depotId: depot.plg }],
      ['store', { role: 'store_manager' as const, outletId }],
    ] as const) {
      cookies[key] = (await signedInAs(app, db, input)).cookie;
    }
    freezeClock(app, AT);
  });

  afterAll(async () => {
    freezeClock(app, AT).reset();
    await close();
    await app.close();
  });

  it('AC-FC-01 ten weeks against capacity', async () => {
    const res = await get(
      'dispatcher',
      `/depots/${depot.plg}/forecasts?weeks=10`,
    );

    expect(res.status).toBe(200);
    const forecast = bodyOf<{ data: DepotForecastDto }>(res).data;
    expect(forecast.weeks.map((w) => [w.isoYear, w.isoWeek])).toEqual(
      WEEKS.map((w) => [2026, w]),
    );
    expect(forecast.weeks[0].weekStart).toBe('2026-10-05');
    expect(forecast.fleet).toMatchObject({ vehicles: 2, reefers: 0 });

    for (const week of forecast.weeks) {
      const gap = week.isoWeek === GAP_WEEK;
      expect(week).toMatchObject({
        totalVolumeM3: gap ? 5000 : 12,
        chilledVolumeM3: 0,
        // 2 trucks × 20 m³ × the trips a vehicle may run a day × the week's operating days.
        capacityM3: 2 * 20 * MAX_TRIPS_PER_VEHICLE_PER_DAY * week.operatingDays,
        overCapacity: gap,
      });
      expect(week.operatingDays).toBeGreaterThan(0);
    }
    expect(forecast.gapWeeks).toBe(1);
    expect(forecast._links.self.href).toBe(
      `/api/v1/depots/${depot.plg}/forecasts?weeks=10`,
    );
  });

  it('reads the forecast only for those allowed, inside their depot', async () => {
    const path = `/depots/${depot.plg}/forecasts?weeks=10`;

    expect((await get('admin', path)).status).toBe(200);
    for (const role of ['store', 'loader', 'driver'] as const) {
      const res = await get(role, path);
      expect([role, res.status]).toEqual([role, 403]);
      expectProblem(res, 'FORBIDDEN');
    }
    const kandy = await get('kandy', path);
    expect(kandy.status).toBe(404);
    expectProblem(kandy, 'NOT_FOUND');
  });

  it('refuses a week count it cannot serve', async () => {
    const res = await get(
      'dispatcher',
      `/depots/${depot.plg}/forecasts?weeks=0`,
    );
    expect(res.status).toBe(400);
    expectProblem(res, 'VALIDATION_FAILED');
  });
});
