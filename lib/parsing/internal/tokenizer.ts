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
  KEYWORD_txn,

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
  Comma,
  Colon,
  ExclamationMark,

  Space,
  Comment,
}

const tokenizer = buildLexer([
  [true, /^[-]?\d+(?:,\d{3})*(?:[.]\d*)?/g, TokenKind.NumberLiteral],
  [true, /^\d{4}-\d{2}-\d{2}/g, TokenKind.DateLiteral],
  [true, /^\d{2}:\d{2}(?::\d{2})?/g, TokenKind.TimeLiteral],
  [true, /^[+-]\d{2}:\d{2}|^Z\b/g, TokenKind.TimeZoneLiteral],
  [true, /^"[^"\n]*"/g, TokenKind.StringLiteral],

  [true, /^balance\b/g, TokenKind.KEYWORD_balance],
  [true, /^close\b/g, TokenKind.KEYWORD_close],
  [true, /^load\b/g, TokenKind.KEYWORD_load],
  [true, /^open\b/g, TokenKind.KEYWORD_open],
  [true, /^option\b/g, TokenKind.KEYWORD_option],

  [true, /^txn\b/g, TokenKind.KEYWORD_txn],

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
  [true, /^,/g, TokenKind.Comma],
  [true, /^:/g, TokenKind.Colon],
  [true, /^!/g, TokenKind.ExclamationMark],

  [false, /^\s+/g, TokenKind.Space],
  [false, /^;[^\n]*(\n|$)/g, TokenKind.Comment],
]);

export function tokenize(contents: string): Token<TokenKind> | undefined {
  return tokenizer.parse(contents);
}
