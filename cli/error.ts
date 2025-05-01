import { BookingError } from '../lib/booking/error.js';
import { LoadError } from '../lib/loading/error.js';

export class CommandError extends Error {
  static fromLoadError(error: LoadError): CommandError {
    const stackTrace = error.stackTrace.map(
      srcCtx => `  loaded from ${srcCtx.filePath}:${srcCtx.row}`,
    );
    return new CommandError(
      [
        `${error.message} at ${error.srcCtx.filePath}:${error.srcCtx.row}`,
        ...stackTrace,
      ].join('\n'),
      { cause: error },
    );
  }

  static fromBookingError(error: BookingError): CommandError {
    return new CommandError(
      `While processing '${error.directive.type}' directive at ` +
        `${error.directive.srcCtx.filePath}:${error.directive.srcCtx.row}: ${error.message}`,
      { cause: error },
    );
  }
}
