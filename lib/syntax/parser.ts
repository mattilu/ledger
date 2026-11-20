import { either as E } from 'fp-ts';
import { expectEOF, expectSingleResult, TokenError } from 'typescript-parsec';

import { ResilientSyntaxTree, SyntaxTree } from './cst/ledger.js';
import { SyntaxError } from './error.js';
import {
  ledgerDirectivesCstParser,
  resilientLedgerDirectivesCstParser,
} from './internal/ledger.js';
import { tokenizeWithTrivia } from './internal/tokenizer.js';

/**
 * Parses Ledger source text into a lossless `SyntaxTree`.
 *
 * Fails on the first lexical or syntactic error encountered in `contents`.
 *
 * @param contents Raw Ledger source text to parse.
 * @returns Either a `SyntaxTree`, or a `SyntaxError` on failure.
 */
export function parseSyntax(
  contents: string,
): E.Either<SyntaxError, SyntaxTree> {
  const { firstToken, eofTrivia, firstUnknownToken } =
    tokenizeWithTrivia(contents);

  if (firstUnknownToken !== undefined) {
    const rest = contents.slice(firstUnknownToken.pos.index);
    const message = `Unable to tokenize the rest of the input: ${rest}`.slice(
      0,
      80,
    );
    return E.left(
      new SyntaxError(
        message,
        {
          row: firstUnknownToken.pos.rowBegin,
          col: firstUnknownToken.pos.columnBegin,
        },
        firstUnknownToken.span,
      ),
    );
  }

  try {
    const directives = expectSingleResult(
      expectEOF(ledgerDirectivesCstParser.parse(firstToken)),
    );
    return E.right({
      source: contents,
      directives,
      eofTrivia,
    });
  } catch (ex: unknown) {
    if (ex instanceof Error) {
      const tokenError = ex as Partial<TokenError>;
      const pos = tokenError.pos;
      return E.left(
        new SyntaxError(
          tokenError.errorMessage?.slice(0, 80) ?? ex.message,
          {
            row: pos?.rowBegin ?? 1,
            col: pos?.columnBegin ?? 1,
          },
          pos === undefined
            ? undefined
            : {
                start: {
                  offset: pos.index,
                  row: pos.rowBegin,
                  col: pos.columnBegin,
                },
                end: {
                  offset: pos.index,
                  row: pos.rowEnd,
                  col: pos.columnEnd,
                },
              },
          { cause: ex },
        ),
      );
    }
    return E.left(
      new SyntaxError(`${ex}`, { row: 1, col: 1 }, undefined, { cause: ex }),
    );
  }
}

/**
 * Parses Ledger source text with token-synchronized error recovery.
 *
 * Malformed directives, postings, or balance entries are wrapped in `ErrorCst`
 * nodes so editor/IDE consumers still receive a complete tree.
 *
 * @param contents Raw Ledger source text to parse.
 * @returns A `ResilientSyntaxTree` containing parsed directives and `ErrorCst`
 *   nodes.
 */
export function parseSyntaxResilient(contents: string): ResilientSyntaxTree {
  const { firstToken, eofTrivia } = tokenizeWithTrivia(contents);
  const directives = expectSingleResult(
    expectEOF(resilientLedgerDirectivesCstParser.parse(firstToken)),
  );
  return {
    source: contents,
    directives,
    eofTrivia,
  };
}
