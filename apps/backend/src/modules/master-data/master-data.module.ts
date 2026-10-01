// apps/backend/src/modules/master-data/master-data.module.ts · owner: Harini
// Depots, districts, outlets, the calendar and the catalog from the booklet's CSVs.
// Spec: specs/master-data/spec.md. Tables: src/db/schema/master-data.ts.
import { Module } from '@nestjs/common';
import { ItemsController } from './controllers/items.controller';

@Module({
  imports: [],
  // Contract first: the catalog's routes and shapes are final and answer 501 until the queries land.
  controllers: [ItemsController],
  providers: [],
  exports: [],
})
export class MasterDataModule {}
