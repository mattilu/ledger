import { SourceContext } from './source-context.js';

export class LoadError extends Error {
  constructor(
    message: string,
    readonly srcCtx: SourceContext,
    readonly stackTrace: readonly SourceContext[],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
