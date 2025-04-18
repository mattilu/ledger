import { SourcePosition } from './source-position.js';

export class ParseError extends Error {
  constructor(
    message: string,
    readonly srcPos: SourcePosition,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
