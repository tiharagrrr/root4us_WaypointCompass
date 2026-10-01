import { StateConflictError } from '../../../core/errors/domain-errors';

/**
 * 409 for deactivating a driver who has a trip today, with a link to
 * reassign it first (screen 20).
 */
export class DriverHasTripsError extends StateConflictError {
  constructor(private readonly tripId: string) {
    super(
      'This driver has a trip today. Reassign it before deactivating the driver.',
    );
  }

  extensions() {
    return {
      _links: {
        reassign: {
          href: `/api/v1/trips/${this.tripId}/reassign`,
          method: 'POST',
          title: 'Reassign trip',
        },
      },
    };
  }
}
