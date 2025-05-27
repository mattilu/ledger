import { Either, left, right } from 'fp-ts/lib/Either.js';
import { buildLexer, Token } from 'typescript-parsec';

export enum TokenKind {
  NumberLiteral,
  DateLiteral,
  TimeLiteral,
  TimeZoneLiteral,
  StringLiteral,

  KEYWORD_balance,
  KEYWORD_close,
  KEYWORD_load,
  KEYWORD_open,
  KEYWORD_option,

  Account,
  Currency,

  Star,
  OpenBrace,
  CloseBrace,
  DoubleOpenBrace,
  DoubleCloseBrace,
  Comma,

  Space,
  Comment,
}

const tokenizer = buildLexer([
  [true, /^[+-]?\d+(?:,\d{3})*(?:[.]\d*)?/g, TokenKind.NumberLiteral],
  [true, /^\d{4}-\d{2}-\d{2}/g, TokenKind.DateLiteral],
  [true, /^\d{2}:\d{2}(?::\d{2})?/g, TokenKind.TimeLiteral],
  [true, /^[+-]\d{2}:\d{2}|^Z\b/g, TokenKind.TimeZoneLiteral],
  [true, /^"[^"\n]*"/g, TokenKind.StringLiteral],

  [true, /^balance\b/g, TokenKind.KEYWORD_balance],
  [true, /^close\b/g, TokenKind.KEYWORD_close],
  [true, /^load\b/g, TokenKind.KEYWORD_load],
  [true, /^open\b/g, TokenKind.KEYWORD_open],
  [true, /^option\b/g, TokenKind.KEYWORD_option],

  [
    true,
    /^(?:Assets|Liabilities|Income|Expenses|Equity|Trading)(?::[A-Z0-9][\w-]+)+/g,
    TokenKind.Account,
  ],
  [true, /^[A-Z][A-Z0-9._-]+/g, TokenKind.Currency],

  [true, /^[*]/g, TokenKind.Star],
  [true, /^{/g, TokenKind.OpenBrace],
  [true, /^}/g, TokenKind.CloseBrace],
  [true, /^{{/g, TokenKind.DoubleOpenBrace],
  [true, /^}}/g, TokenKind.DoubleCloseBrace],
  [true, /^,/g, TokenKind.Comma],

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
