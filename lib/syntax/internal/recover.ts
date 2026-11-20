import { Parser, ParserOutput, Token } from 'typescript-parsec';

import { ErrorCst } from '../cst/error.js';
import { RichToken, TokenKind } from '../token.js';

const UNDATED_DIRECTIVE_KEYWORDS = new Set(['account-rule', 'load', 'option']);
const DATED_DIRECTIVE_FOLLOW_KEYWORDS = new Set([
  'txn',
  'balance',
  'close',
  'currency',
  'commodity',
  'open',
  'price',
]);

/**
 * Checks whether `token` begins a top-level Ledger directive.
 *
 * Matches either an undated keyword (`account-rule`, `load`, `option`) or a
 * `DateLiteral` (with optional time and timezone) followed by a dated directive
 * keyword or transaction flag.
 *
 * @param token Candidate token to inspect.
 * @returns `true` if `token` starts a directive, otherwise `false`.
 */
export function isDirectiveStart(token: Token<TokenKind> | undefined): boolean {
  if (token === undefined) {
    return false;
  }
  if (
    token.kind === TokenKind.Identifier &&
    UNDATED_DIRECTIVE_KEYWORDS.has(token.text)
  ) {
    return true;
  }
  if (token.kind === TokenKind.DateLiteral && token.next !== undefined) {
    let afterDate: Token<TokenKind> | undefined = token.next;
    if (afterDate.kind === TokenKind.TimeLiteral) {
      afterDate = afterDate.next;
      if (afterDate?.kind === TokenKind.TimeZoneLiteral) {
        afterDate = afterDate.next;
      }
    }
    if (afterDate === undefined) {
      return false;
    }
    if (
      afterDate.kind === TokenKind.Times ||
      afterDate.kind === TokenKind.ExclamationMark
    ) {
      return true;
    }
    if (
      afterDate.kind === TokenKind.Identifier &&
      DATED_DIRECTIVE_FOLLOW_KEYWORDS.has(afterDate.text)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether `token` begins a transaction posting.
 *
 * Matches an optional `*` or `!` flag followed by an account name or
 * `choose account`.
 *
 * @param token Candidate token to inspect.
 * @returns `true` if `token` starts a posting, otherwise `false`.
 */
export function isPostingStart(token: Token<TokenKind> | undefined): boolean {
  if (token === undefined) {
    return false;
  }
  let cur: Token<TokenKind> | undefined = token;
  if (cur.kind === TokenKind.Times || cur.kind === TokenKind.ExclamationMark) {
    cur = cur.next;
  }
  if (cur === undefined) {
    return false;
  }
  if (cur.kind === TokenKind.Account) {
    return true;
  }
  return (
    cur.kind === TokenKind.Identifier &&
    cur.text === 'choose' &&
    cur.next?.kind === TokenKind.Identifier &&
    cur.next.text === 'account'
  );
}

/**
 * Checks whether `token` begins a `balance` assertion entry.
 *
 * @param token Candidate token to inspect.
 * @returns `true` if `token` is an account token, otherwise `false`.
 */
export function isBalanceEntryStart(
  token: Token<TokenKind> | undefined,
): boolean {
  return token?.kind === TokenKind.Account;
}

/**
 * Wraps `parser` with token-synchronized error recovery.
 *
 * When `guardPredicate` is provided and returns `false` at the current token,
 * parsing fails cleanly so enclosing repetition combinators (`rep_sc`) stop
 * without consuming tokens belonging to an outer construct. Otherwise, if
 * `parser` fails, tokens are skipped until `isSyncPoint` returns `true` (or
 * EOF) and wrapped into an `ErrorCst` node so parsing can continue.
 *
 * @param parser Underlying parser to attempt first.
 * @param isSyncPoint Predicate identifying synchronization tokens where
 *   recovery stops skipping.
 * @param guardPredicate Optional predicate that must hold at the current token
 *   before attempting recovery.
 * @returns A parser yielding either `TResult` or an `ErrorCst` node.
 */
export function recoverUntil<TResult>(
  parser: Parser<TokenKind, TResult>,
  isSyncPoint: (token: RichToken) => boolean,
  guardPredicate?: (token: RichToken) => boolean,
): Parser<TokenKind, TResult | ErrorCst> {
  return {
    parse(
      token: Token<TokenKind> | undefined,
    ): ParserOutput<TokenKind, TResult | ErrorCst> {
      if (token === undefined) {
        return parser.parse(token);
      }

      const startRich = token as RichToken;
      if (guardPredicate !== undefined && !guardPredicate(startRich)) {
        return {
          successful: false,
          error: {
            kind: 'Error',
            pos: token.pos,
            message: `Unable to consume token: ${token.text}`,
          },
        };
      }

      const output = parser.parse(token);
      if (output.successful) {
        return output;
      }

      const skipped: RichToken[] = [startRich];
      let cur = startRich.next;
      while (cur !== undefined && !isSyncPoint(cur)) {
        skipped.push(cur);
        cur = cur.next;
      }

      const lastSkipped = skipped[skipped.length - 1];
      const errPos = output.error.pos ?? startRich.pos;
      const errorNode: ErrorCst = {
        type: 'error',
        tokens: skipped,
        message: output.error.message,
        errorPos: {
          row: errPos.rowBegin,
          col: errPos.columnBegin,
        },
        span: {
          start: startRich.span.start,
          end: lastSkipped.span.end,
        },
      };

      return {
        successful: true,
        candidates: [
          {
            firstToken: token,
            nextToken: cur,
            result: errorNode,
          },
        ],
        error: output.error,
      };
    },
  };
}
