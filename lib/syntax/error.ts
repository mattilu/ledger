import { SourcePosition } from '../parsing/source-position.js';
import { SourceSpan } from './source-span.js';

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
