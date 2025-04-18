import { Either, isLeft, left, right } from 'fp-ts/lib/Either.js';
import { expectEOF, TokenError } from 'typescript-parsec';

import { ParseError } from './error.js';
import { ledgerParser } from './internal/ledger.js';
import { tokenize } from './internal/tokenizer.js';
import { LedgerSpec } from './spec/ledger.js';

export interface ParseContext {
  readonly filePath: string;
}

export function parse(contents: string): Either<ParseError, LedgerSpec> {
  const tokenized = tokenize(contents);
  if (isLeft(tokenized)) {
    const tokenError = tokenized.left as TokenError;
    return left(
      new ParseError(
        tokenError.errorMessage.slice(0, 80),
        {
          row: tokenError.pos?.rowBegin ?? 1,
          col: tokenError.pos?.columnBegin ?? 1,
        },
        { cause: tokenized.left },
      ),
    );
  }

  const parsed = expectEOF(ledgerParser.parse(tokenized.right));

  if (!parsed.successful) {
    return left(
      new ParseError(parsed.error.message, {
        row: parsed.error.pos?.rowBegin ?? 1,
        col: parsed.error.pos?.columnBegin ?? 1,
      }),
    );
  }

  if (parsed.candidates.length === 0) {
    return left(new ParseError('No results returned', { row: 1, col: 1 }));
  } else if (parsed.candidates.length > 1) {
    return left(new ParseError('Ambiguous result', { row: 1, col: 1 }));
  }

  return right(parsed.candidates[0].result);
}
