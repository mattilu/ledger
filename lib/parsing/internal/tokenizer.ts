import { Either, left, right } from 'fp-ts/lib/Either.js';
import { buildLexer, Token } from 'typescript-parsec';

export enum TokenKind {
  NumberLiteral,
  DateLiteral,
  TimeLiteral,
  TimeZoneLiteral,
  StringLiteral,

  KEYWORD_open,

  Account,
  Currency,

  Star,

  Space,
  Comment,
}

const tokenizer = buildLexer([
  [true, /^[+-]?\d+(?:[.]\d*)?/g, TokenKind.NumberLiteral],
  [true, /^\d{4}-\d{2}-\d{2}/g, TokenKind.DateLiteral],
  [true, /^\d{2}:\d{2}(?::\d{2})?/g, TokenKind.TimeLiteral],
  [true, /^[+-]\d{2}:\d{2}|^Z\b/g, TokenKind.TimeZoneLiteral],
  [true, /^"[^"\n]*"/g, TokenKind.StringLiteral],

  [true, /^open\b/g, TokenKind.KEYWORD_open],

  [
    true,
    /^(?:Assets|Liabilities|Income|Expenses|Equity|Trading)(?::[A-Z][\w-]+)+/g,
    TokenKind.Account,
  ],
  [true, /^[A-Z][A-Z0-9_-]+/g, TokenKind.Currency],

  [true, /^[*]/g, TokenKind.Star],

  [false, /^\s+/g, TokenKind.Space],
  [false, /^;[^\n]*(\n|$)/g, TokenKind.Comment],
]);

export function tokenize(
  contents: string,
): Either<Error, Token<TokenKind> | undefined> {
  try {
    return right(tokenizer.parse(contents));
  } catch (ex) {
    if (ex instanceof Error) {
      return left(ex);
    }
    return left(new Error(`${ex}`));
  }
}
