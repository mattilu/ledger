import { BookingError } from '../lib/booking/error.js';
import { FormatError } from '../lib/formatting/error.js';
import { LoadError } from '../lib/loading/error.js';
import { sanitizeTerminalText } from '../lib/utils/terminal.js';

export { sanitizeTerminalText };

export class CommandError extends Error {
  /**
   * Converts a `FormatError` into a user-facing `CommandError`.
   *
   * @param error Underlying formatter or syntax error.
   * @param filePath File path or `<stdin>` label for location formatting.
   * @returns A `CommandError` preserving `error` as its `cause`.
   */
  static fromFormatError(error: FormatError, filePath: string): CommandError {
    const safePath = sanitizeTerminalText(filePath, undefined, true);
    const safeMessage = sanitizeTerminalText(error.message);
    const location = error.srcPos
      ? `${safePath}:${error.srcPos.row}:${error.srcPos.col}`
      : safePath;
    return new CommandError(`${safeMessage} at ${location}`, {
      cause: error,
    });
  }

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
