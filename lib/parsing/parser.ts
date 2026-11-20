import { either as E, function as F } from 'fp-ts';

import { parseSyntax } from '../syntax/parser.js';
import { ParseError } from './error.js';
import { lowerSyntaxTree } from './internal/lower.js';
import { LedgerSpec } from './spec/ledger.js';

export { lowerSyntaxTree };

export interface ParseContext {
  readonly filePath: string;
}

/**
 * Parses Ledger source text into a semantic `LedgerSpec` AST.
 *
 * @param contents Raw Ledger source text to parse.
 * @returns Either a `LedgerSpec`, or a `ParseError` on failure.
 */
export function parse(contents: string): E.Either<ParseError, LedgerSpec> {
  return F.pipe(
    parseSyntax(contents),
    E.bimap(
      err => new ParseError(err.message, err.srcPos, { cause: err }),
      lowerSyntaxTree,
    ),
  );
}
