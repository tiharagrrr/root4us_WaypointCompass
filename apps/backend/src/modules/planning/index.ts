// The planning module's public surface: other modules import from this file only.
export { PlanningModule } from './planning.module';

/** The one way another module moves trip or stop status (architecture rule 2). */
export {
  TripLifecycleService,
  type StopRow,
  type TripRow,
} from './services/trip-lifecycle.service';
/** The one way another module records a deferral it caused (AC-LOD-12). */
export {
  DeferralService,
  type DeferralRow,
  type PartialDeferral,
  type PartialDeferralInput,
} from './services/deferral.service';
export { PLANNING_AUDIT } from './planning.constants';
