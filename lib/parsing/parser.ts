import { Either, tryCatchK } from 'fp-ts/lib/Either.js';
import { flow, pipe } from 'fp-ts/lib/function.js';
import { expectSingleResult, TokenError } from 'typescript-parsec';

import { ParseError } from './error.js';
import { ledgerParser } from './internal/ledger.js';
import { tokenize } from './internal/tokenizer.js';
import { LedgerSpec } from './spec/ledger.js';

export interface ParseContext {
  readonly filePath: string;
}

export function parse(contents: string): Either<ParseError, LedgerSpec> {
  return pipe(
    contents,
    tryCatchK(
      flow(tokenize, ledgerParser.parse, expectSingleResult),
      (ex: unknown) => {
        if (ex instanceof Error) {
          const tokenError = ex as Partial<TokenError>;
          return new ParseError(
            tokenError.errorMessage?.slice(0, 80) ?? ex.message,
            {
              row: tokenError.pos?.rowBegin ?? 1,
              col: tokenError.pos?.columnBegin ?? 1,
            },
            { cause: ex },
          );
        }
        return new ParseError(`${ex}`, { row: 1, col: 1 }, { cause: ex });
      },
    ),
  );
}
