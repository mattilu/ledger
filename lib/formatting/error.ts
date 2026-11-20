import { SourcePosition } from '../parsing/source-position.js';

export class FormatError extends Error {
  constructor(
    message: string,
    readonly srcPos?: SourcePosition,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
