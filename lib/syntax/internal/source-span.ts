import { Token } from 'typescript-parsec';

import { SourceSpan } from '../source-span.js';
import { RichToken, TokenKind } from '../token.js';

/**
 * Casts a `typescript-parsec` `Token` from `tokenizeWithTrivia` to `RichToken`.
 *
 * @param token Token produced by `tokenizeWithTrivia`.
 * @returns The token narrowed to `RichToken`.
 */
export function asRichToken(token: Token<TokenKind>): RichToken {
  return token as RichToken;
}

/**
 * Derives a `SourceSpan` from a `typescript-parsec` `[first, next]` range.
 *
 * Passed to `apply(...)` callbacks, where `next` is the first unconsumed token
 * following the match (or `undefined` at EOF).
 *
 * @param tokenRange Start and exclusive-end token pair from `apply(...)`.
 * @returns The `SourceSpan` covering all consumed tokens in the range.
 */
export function spanFromRange(
  tokenRange: [Token<TokenKind> | undefined, Token<TokenKind> | undefined],
): SourceSpan {
  const first = tokenRange[0] as RichToken | undefined;
  const next = tokenRange[1] as RichToken | undefined;

  if (first === undefined) {
    const zero = { offset: 0, row: 1, col: 1 };
    return { start: zero, end: zero };
  }

  if (next === first) {
    return { start: first.span.start, end: first.span.start };
  }

  if (next !== undefined && next.prev !== undefined) {
    return { start: first.span.start, end: next.prev.span.end };
  }

  let cur: RichToken = first;
  while (cur.next !== undefined && cur.next !== next) {
    cur = cur.next;
  }
  return { start: first.span.start, end: cur.span.end };
}

/**
 * Computes a `SourceSpan` spanning from `first` through `last`.
 *
 * Used for `lrec_sc` left-recursive combinator callbacks, where
 * `typescript-parsec` only supplies `(lhs, rhs)` and does not pass a
 * `TokenRange` tuple for `spanFromRange`.
 *
 * @param first Leftmost CST node.
 * @param last Rightmost CST node.
 * @returns The combined `SourceSpan` from `first.span.start` to
 *   `last.span.end`.
 */
export function spanFromNodes(
  first: { readonly span: SourceSpan },
  last: { readonly span: SourceSpan },
): SourceSpan {
  return { start: first.span.start, end: last.span.end };
}
