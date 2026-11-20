import { SourcePosition, SourceSpan } from './source-span.js';

export class SyntaxError extends Error {
  constructor(
    message: string,
    readonly srcPos: SourcePosition,
    readonly span?: SourceSpan,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
