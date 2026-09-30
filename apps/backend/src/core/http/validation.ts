import {
  ValidationPipe,
  type ValidationError as ClassError,
} from '@nestjs/common';
import { type FieldError, ValidationError } from '../errors/domain-errors';

/** DTO checks for every route: unknown fields are refused, not dropped. */
export const validationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidationError(toFieldErrors(errors)),
  });

/** class-validator's nested errors as [{ field: 'lines[2].qty', code, message }]. */
export function toFieldErrors(errors: ClassError[], prefix = ''): FieldError[] {
  return errors.flatMap((e) => {
    const field = /^\d+$/.test(e.property)
      ? `${prefix}[${e.property}]`
      : prefix
        ? `${prefix}.${e.property}`
        : e.property;
    const own = Object.entries(e.constraints ?? {}).map(([code, message]) =>
      code === 'whitelistValidation'
        ? {
            field,
            code: 'not_allowed',
            message: 'This field can’t be set here',
          }
        : { field, code, message },
    );
    return [...own, ...toFieldErrors(e.children ?? [], field)];
  });
}
