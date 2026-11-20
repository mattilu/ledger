import { Parser, ParserOutput, Token } from 'typescript-parsec';

import { sanitizeTerminalText } from '../../utils/terminal.js';
import { ErrorCst } from '../cst/error.js';
import { RichToken, TokenKind } from '../token.js';

const UNDATED_DIRECTIVE_KEYWORDS = new Set(['account-rule', 'load', 'option']);
const NON_DIRECTIVE_FOLLOW_KINDS = new Set<TokenKind>([
  TokenKind.Colon,
  TokenKind.Equal,
  TokenKind.NotEqual,
  TokenKind.LessThan,
  TokenKind.LessThanOrEqual,
  TokenKind.GreaterThan,
  TokenKind.GreaterThanOrEqual,
  TokenKind.CloseParen,
  TokenKind.Comma,
  TokenKind.CloseBrace,
]);
const NON_DIRECTIVE_FOLLOW_KEYWORDS = new Set(['is', 'and', 'or']);
const DATED_DIRECTIVE_FOLLOW_KEYWORDS = new Set([
  'txn',
  'balance',
  'close',
  'currency',
  'commodity',
  'open',
  'price',
]);

function isPostingFlagFollow(token: Token<TokenKind> | undefined): boolean {
  if (token === undefined) {
    return false;
  }
  if (token.kind === TokenKind.Account) {
    return true;
  }
  return (
    token.kind === TokenKind.Identifier &&
    token.text === 'choose' &&
    token.next?.kind === TokenKind.Identifier &&
    token.next.text === 'account'
  );
}

/**
 * Checks whether `token` is a `DateLiteral` starting at column 1 on its line.
 *
 * Used during resilient recovery to terminate transaction/balance bodies before
 * a malformed top-level dated directive (such as `2026-06-02 unknown-dir ...`)
 * so its tokens are not absorbed into the preceding directive.
 *
 * @param token Candidate token to inspect.
 * @returns `true` if `token` begins a line at column 1 with a date literal.
 */
export function isTopLevelDateStart(token: RichToken): boolean {
  return (
    token.kind === TokenKind.DateLiteral &&
    token.span.start.col === 1 &&
    (token.hasLeadingNewline || token.prev === undefined)
  );
}

/**
 * Checks whether `token` begins a top-level Ledger directive.
 *
 * Matches either an undated keyword (`account-rule`, `load`, `option`) not
 * followed by a metadata colon, comparison operator, or boolean/rule
 * continuation token, or a `DateLiteral` (with optional time and timezone)
 * followed by a dated directive keyword or transaction flag.
 *
 * When `insideBraces` is `true`, undated keywords only match when followed by
 * a `StringLiteral` (the required argument of `account-rule`, `load`, and
 * `option`), and dated directives must start on a new line, preventing broken
 * conditions inside `{ ... }` blocks from prematurely splitting an enclosing
 * transaction.
 *
 * @param token Candidate token to inspect.
 * @param insideBraces Whether recovery is currently inside `{ ... }` braces.
 * @returns `true` if `token` starts a directive, otherwise `false`.
 */
export function isDirectiveStart(
  token: Token<TokenKind> | undefined,
  insideBraces = false,
): boolean {
  if (token === undefined) {
    return false;
  }
  if (
    token.kind === TokenKind.Identifier &&
    UNDATED_DIRECTIVE_KEYWORDS.has(token.text)
  ) {
    const next = token.next;
    if (insideBraces) {
      return next?.kind === TokenKind.StringLiteral;
    }
    if (
      next !== undefined &&
      (NON_DIRECTIVE_FOLLOW_KINDS.has(next.kind) ||
        (next.kind === TokenKind.Identifier &&
          NON_DIRECTIVE_FOLLOW_KEYWORDS.has(next.text)))
    ) {
      return false;
    }
    return true;
  }
  if (token.kind === TokenKind.DateLiteral && token.next !== undefined) {
    const rich = token as RichToken;
    if (insideBraces && !rich.hasLeadingNewline && rich.prev !== undefined) {
      return false;
    }
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
    const follow = afterDate.next;
    if (
      afterDate.kind === TokenKind.Times ||
      afterDate.kind === TokenKind.ExclamationMark
    ) {
      if (insideBraces) {
        return follow?.kind === TokenKind.StringLiteral;
      }
      if (isPostingFlagFollow(follow)) {
        return false;
      }
      if (
        rich.prev?.kind === TokenKind.Colon &&
        follow?.kind !== TokenKind.StringLiteral
      ) {
        return false;
      }
      return true;
    }
    if (
      afterDate.kind === TokenKind.Identifier &&
      DATED_DIRECTIVE_FOLLOW_KEYWORDS.has(afterDate.text)
    ) {
      if (
        follow !== undefined &&
        (NON_DIRECTIVE_FOLLOW_KINDS.has(follow.kind) ||
          (follow.kind === TokenKind.Identifier &&
            NON_DIRECTIVE_FOLLOW_KEYWORDS.has(follow.text)))
      ) {
        return false;
      }
      if (insideBraces && afterDate.text === 'txn') {
        return follow?.kind === TokenKind.StringLiteral;
      }
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

function braceDelta(kind: TokenKind): number {
  switch (kind) {
    case TokenKind.OpenBrace:
    case TokenKind.DoubleOpenBrace:
      return 1;
    case TokenKind.CloseBrace:
    case TokenKind.DoubleCloseBrace:
      return -1;
    default:
      return 0;
  }
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
 *   recovery stops skipping; receives the candidate token and current nesting
 *   brace depth within the skipped tokens.
 * @param guardPredicate Optional predicate that must hold at the current token
 *   before attempting recovery.
 * @returns A parser yielding either `TResult` or an `ErrorCst` node.
 */
export function recoverUntil<TResult>(
  parser: Parser<TokenKind, TResult>,
  isSyncPoint: (token: RichToken, braceDepth: number) => boolean,
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
            message: `Unable to consume token: ${sanitizeTerminalText(token.text)}`,
          },
        };
      }

      const output = parser.parse(token);
      if (output.successful) {
        return output;
      }

      const skipped: RichToken[] = [startRich];
      let braceDepth = Math.max(0, braceDelta(startRich.kind));
      let cur = startRich.next;
      while (cur !== undefined && !isSyncPoint(cur, braceDepth)) {
        skipped.push(cur);
        braceDepth = Math.max(0, braceDepth + braceDelta(cur.kind));
        cur = cur.next;
      }

      const lastSkipped = skipped[skipped.length - 1];
      const errPos = output.error.pos ?? startRich.pos;
      const errorNode: ErrorCst = {
        type: 'error',
        tokens: skipped,
        message: sanitizeTerminalText(output.error.message),
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
