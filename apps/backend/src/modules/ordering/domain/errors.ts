import {
  StateConflictError,
  ValidationError,
} from '../../../core/errors/domain-errors';

/**
 * A second non-cancelled order for the same outlet, requested date and class
 * (AC-ORD-04). The problem carries a link to the order that already exists,
 * so M1 can offer to open it instead of guessing.
 */
export class DuplicateOrderError extends StateConflictError {
  constructor(readonly existingOrderId: string) {
    super(
      'This outlet already has an order of this class for that date. Edit that one instead.',
    );
  }

  extensions() {
    return {
      _links: {
        existing: {
          href: `/api/v1/orders/${this.existingOrderId}`,
          title: 'Open the existing order',
        },
      },
    };
  }
}

/** A template name already taken at the outlet (AC-ORD-27). */
export class DuplicateTemplateError extends StateConflictError {
  constructor(name: string) {
    super(`A preset called "${name}" already exists. Choose another name.`);
  }
}

/** Only drafts are removed; anything sent is cancelled instead (AC-ORD-18). */
export class OrderNotDraftError extends StateConflictError {
  constructor() {
    super('Only a draft can be deleted. Cancel the order instead.');
  }
}

/** One field is wrong, named the way the screens expect. */
export const fieldError = (field: string, code: string, message: string) =>
  new ValidationError([{ field, code, message }]);
