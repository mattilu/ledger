import { either as E } from 'fp-ts';

import { parseSyntax } from '../syntax/parser.js';
import { FormatError } from './error.js';
import { renderSegments } from './internal/align.js';
import { buildTopLevelSegments } from './internal/directives.js';
import { verifyFormattedOutput } from './internal/verify.js';
import {
  DEFAULT_FORMAT_OPTIONS,
  FormatOptions,
  resolveFormatOptions,
} from './options.js';

export * from './error.js';
export * from './options.js';

/**
 * Formats Ledger source text according to `options`.
 *
 * Re-parses the formatted output to verify that semantic `LedgerSpec` meaning
 * and all `;` comments are preserved before returning.
 *
 * @param contents Raw Ledger source text to format.
 * @param options Optional formatting configuration overrides.
 * @returns Either the formatted Ledger text, or a `FormatError` on failure.
 */
export function format(
  contents: string,
  options?: Partial<FormatOptions>,
): E.Either<FormatError, string> {
  const resolvedOpts =
    options === undefined
      ? E.right(DEFAULT_FORMAT_OPTIONS)
      : resolveFormatOptions(options);
  if (E.isLeft(resolvedOpts)) {
    return resolvedOpts;
  }
  const opts = resolvedOpts.right;

  const parsed = parseSyntax(contents);
  if (E.isLeft(parsed)) {
    return E.left(
      new FormatError(parsed.left.message, parsed.left.srcPos, {
        cause: parsed.left,
      }),
    );
  }

  const tree = parsed.right;
  if (tree.directives.length === 0 && tree.eofTrivia.length === 0) {
    return E.right('');
  }

  const segments = buildTopLevelSegments(
    contents,
    tree.directives,
    tree.eofTrivia,
    opts,
  );

  if (segments.length === 0) {
    return E.right('');
  }

  const body = renderSegments(segments, opts);
  const formatted = body.length === 0 ? '' : `${body}\n`;

  const verified = verifyFormattedOutput(tree, formatted, opts);
  if (E.isLeft(verified)) {
    return verified;
  }

  return E.right(formatted);
}
