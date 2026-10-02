// apps/backend/src/modules/master-data/master-data.module.ts · owner: Harini
// Depots, districts, outlets, the calendar and the catalog from the booklet's CSVs.
// Spec: specs/master-data/spec.md. Tables: src/db/schema/master-data.ts.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CalendarController } from './controllers/calendar.controller';
import { DepotsController } from './controllers/depots.controller';
import { DistrictsController } from './controllers/districts.controller';
import { ItemsController } from './controllers/items.controller';
import { OutletsController } from './controllers/outlets.controller';
import { ReferenceController } from './controllers/reference.controller';
import { DepotLinks } from './policies/depot.links';
import { DistrictLinks } from './policies/district.links';
import { ItemLinks } from './policies/item.links';
import { DepotScope, OutletScope } from './policies/master-data.scope';
import { OutletLinks } from './policies/outlet.links';
import { CalendarService } from './services/calendar.service';
import { DepotsService } from './services/depots.service';
import { ItemQueries } from './services/item.queries';
import { OutletQueries } from './services/outlet.queries';
import { OutletsService } from './services/outlets.service';
import { ReferenceQueries } from './services/reference.queries';

const providers = [
  CalendarService,
  DepotsService,
  DepotLinks,
  DepotScope,
  DistrictLinks,
  ItemLinks,
  ItemQueries,
  OutletLinks,
  OutletQueries,
  OutletScope,
  OutletsService,
  ReferenceQueries,
];

@Module({
  imports: [AuditModule],
  controllers: [
    CalendarController,
    DepotsController,
    DistrictsController,
    ItemsController,
    OutletsController,
    ReferenceController,
  ],
  providers,
  // Ordering reads the calendar for the cutoff, and outlets and items to
  // validate and snapshot an order's lines.
  exports: [CalendarService, ItemQueries, OutletQueries, ReferenceQueries],
})
export class MasterDataModule {}
