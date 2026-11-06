import { buildLexer, Token } from 'typescript-parsec';

export enum TokenKind {
  NumberLiteral,
  DateLiteral,
  TimeLiteral,
  TimeZoneLiteral,
  StringLiteral,

  Identifier,

  Account,
  Currency,

  Plus,
  Minus,
  Times,
  Divide,

  OpenParen,
  CloseParen,
  OpenBrace,
  CloseBrace,
  DoubleOpenBrace,
  DoubleCloseBrace,
  At,
  DoubleAt,
  Comma,
  Colon,
  ExclamationMark,
  Tilde,

  Space,
  Comment,
}

const tokenizer = buildLexer([
  [true, /^[-]?\d+(?:,\d{3})*(?:[.]\d*)?/g, TokenKind.NumberLiteral],
  [true, /^\d{4}-\d{2}-\d{2}/g, TokenKind.DateLiteral],
  [true, /^\d{2}:\d{2}(?::\d{2})?/g, TokenKind.TimeLiteral],
  [true, /^[+-]\d{2}:\d{2}|^Z\b/g, TokenKind.TimeZoneLiteral],
  [true, /^"[^"\n]*"/g, TokenKind.StringLiteral],
  [true, /^[a-z][a-z0-9_-]*/g, TokenKind.Identifier],
  [
    true,
    /^(?:Assets|Liabilities|Income|Expenses|Equity|Trading)(?::[A-Z0-9][\w-]+)+/g,
    TokenKind.Account,
  ],
  [true, /^[A-Z][A-Z0-9._-]+/g, TokenKind.Currency],

  [true, /^[+]/g, TokenKind.Plus],
  [true, /^[-]/g, TokenKind.Minus],
  [true, /^[*]/g, TokenKind.Times],
  [true, /^[/]/g, TokenKind.Divide],

  [true, /^[(]/g, TokenKind.OpenParen],
  [true, /^[)]/g, TokenKind.CloseParen],
  [true, /^{/g, TokenKind.OpenBrace],
  [true, /^}/g, TokenKind.CloseBrace],
  [true, /^{{/g, TokenKind.DoubleOpenBrace],
  [true, /^}}/g, TokenKind.DoubleCloseBrace],
  [true, /^@/g, TokenKind.At],
  [true, /^@@/g, TokenKind.DoubleAt],
  [true, /^,/g, TokenKind.Comma],
  [true, /^:/g, TokenKind.Colon],
  [true, /^!/g, TokenKind.ExclamationMark],
  [true, /^~/g, TokenKind.Tilde],

  [false, /^\s+/g, TokenKind.Space],
  [false, /^;[^\n]*(\n|$)/g, TokenKind.Comment],
]);

export function tokenize(contents: string): Token<TokenKind> | undefined {
  return tokenizer.parse(contents);
}
