import { apply, Parser, str, tok } from 'typescript-parsec';

import { RichToken, TokenKind } from '../token.js';
import { asRichToken } from './source-span.js';

/**
 * Matches a single token of `kind` typed as `RichToken`.
 *
 * @param kind Token kind to match.
 * @returns A parser yielding the matched `RichToken`.
 */
export function richTok(kind: TokenKind): Parser<TokenKind, RichToken> {
  return apply(tok(kind), asRichToken);
}

/**
 * Matches a single token with exact text `value` typed as `RichToken`.
 *
 * @param value Exact token text to match.
 * @returns A parser yielding the matched `RichToken`.
 */
export function richStr(value: string): Parser<TokenKind, RichToken> {
  return apply(str<TokenKind>(value), asRichToken);
}
