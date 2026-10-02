// The planning module's public surface: other modules import from this file only.
export { PlanningModule } from './planning.module';

/** The one way another module moves trip or stop status (architecture rule 2). */
export {
  TripLifecycleService,
  type StopRow,
  type TripRow,
} from './services/trip-lifecycle.service';
export { PLANNING_AUDIT } from './planning.constants';
