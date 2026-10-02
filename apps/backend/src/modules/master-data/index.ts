// The master-data module's public surface: other modules import from this file only.
export { MasterDataModule } from './master-data.module';
export {
  CalendarService,
  type CalendarDayRow,
} from './services/calendar.service';
export { ItemQueries, type ItemRow } from './services/item.queries';
export { OutletQueries, type OutletRow } from './services/outlet.queries';
export {
  ReferenceQueries,
  type DepotRow,
  type DistrictRow,
} from './services/reference.queries';
export {
  effectiveWindow,
  type TimeWindow,
  type WindowedOutlet,
} from './domain/windows';
export {
  OUTLET_UPDATED,
  type OutletUpdatedEvent,
} from './services/outlets.service';
