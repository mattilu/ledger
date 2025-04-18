import { Directive } from '../loading/directive.js';

export class BookingError extends Error {
  constructor(
    message: string,
    readonly directive: Directive,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
