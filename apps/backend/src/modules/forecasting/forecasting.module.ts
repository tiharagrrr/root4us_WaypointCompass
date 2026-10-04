// apps/backend/src/modules/forecasting/forecasting.module.ts · owner: Tihara
// The weeks ahead against fleet capacity, and expected demand for plan ahead.
// Spec: specs/forecasting/spec.md. Tables: src/db/schema/forecasting.ts.
import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data';
import { DepotForecastsController } from './controllers/depot-forecasts.controller';
import { ForecastScope } from './policies/forecast.scope';
import { ForecastQueries } from './services/forecast.queries';

@Module({
  imports: [MasterDataModule],
  controllers: [DepotForecastsController],
  providers: [ForecastScope, ForecastQueries],
  exports: [],
})
export class ForecastingModule {}
