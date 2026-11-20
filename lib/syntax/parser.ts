import { either as E } from 'fp-ts';
import {
  expectEOF,
  expectSingleResult,
  TokenError,
  TokenPosition,
} from 'typescript-parsec';

import { sanitizeTerminalText } from '../utils/terminal.js';
import { ResilientSyntaxTree, SyntaxTree } from './cst/ledger.js';
import { SyntaxError } from './error.js';
import {
  ledgerDirectivesCstParser,
  resilientLedgerDirectivesCstParser,
} from './internal/ledger.js';
import { tokenizeWithTrivia } from './internal/tokenizer.js';
import { SourceSpan } from './source-span.js';
import { RichToken } from './token.js';

function findSpanForTokenPos(
  firstToken: RichToken | undefined,
  pos: TokenPosition,
  contents: string,
): SourceSpan {
  for (let tok = firstToken; tok !== undefined; tok = tok.next) {
    if (tok.pos.index === pos.index) {
      return tok.span;
    }
    if (tok.pos.index > pos.index) {
      break;
    }
  }
  const endOffset =
    pos.rowBegin === pos.rowEnd
      ? Math.min(
          contents.length,
          pos.index + Math.max(0, pos.columnEnd - pos.columnBegin),
        )
      : pos.index;
  return {
    start: {
      offset: pos.index,
      row: pos.rowBegin,
      col: pos.columnBegin,
    },
    end: {
      offset: endOffset,
      row: pos.rowEnd,
      col: pos.columnEnd,
    },
  };
}

function makeUnknownTokenError(
  firstUnknownToken: RichToken,
  contents: string,
): SyntaxError {
  const start = firstUnknownToken.pos.index;
  const prefix = 'Unable to tokenize the rest of the input: ';
  const maxRestLen = Math.max(0, 80 - prefix.length);
  const rest = sanitizeTerminalText(
    contents.slice(start, start + maxRestLen),
    maxRestLen,
  );
  const message = `${prefix}${rest}`;
  return new SyntaxError(
    message,
    {
      row: firstUnknownToken.pos.rowBegin,
      col: firstUnknownToken.pos.columnBegin,
    },
    firstUnknownToken.span,
  );
}

const MAX_SYNTAX_ERROR_MESSAGE_LEN = 200;

function formatTokenErrorMessage(raw: string): string {
  const sanitized = sanitizeTerminalText(raw);
  if (sanitized.length <= MAX_SYNTAX_ERROR_MESSAGE_LEN) {
    return sanitized;
  }
  const truncated = sanitizeTerminalText(raw, MAX_SYNTAX_ERROR_MESSAGE_LEN - 3);
  return `${truncated}...`;
}

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

  try {
    const directives = expectSingleResult(
      expectEOF(ledgerDirectivesCstParser.parse(firstToken)),
    );
    if (firstUnknownToken !== undefined) {
      return E.left(makeUnknownTokenError(firstUnknownToken, contents));
    }
    return E.right({
      source: contents,
      directives,
      eofTrivia,
    });
  } catch (ex: unknown) {
    if (ex instanceof Error) {
      const tokenError = ex as Partial<TokenError>;
      const pos = tokenError.pos;
      if (
        firstUnknownToken !== undefined &&
        (pos === undefined || pos.index >= firstUnknownToken.pos.index)
      ) {
        return E.left(makeUnknownTokenError(firstUnknownToken, contents));
      }
      return E.left(
        new SyntaxError(
          tokenError.errorMessage !== undefined
            ? formatTokenErrorMessage(tokenError.errorMessage)
            : sanitizeTerminalText(ex.message),
          {
            row: pos?.rowBegin ?? 1,
            col: pos?.columnBegin ?? 1,
          },
          pos === undefined
            ? undefined
            : findSpanForTokenPos(firstToken, pos, contents),
          { cause: ex },
        ),
      );
    }
    return E.left(
      new SyntaxError(
        sanitizeTerminalText(`${ex}`),
        { row: 1, col: 1 },
        undefined,
        {
          cause: ex,
        },
      ),
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
