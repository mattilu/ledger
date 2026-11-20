import { SourcePosition } from '../syntax/source-span.js';

export class FormatError extends Error {
  constructor(
    message: string,
    readonly srcPos?: SourcePosition,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
