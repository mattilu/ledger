import { Token, TokenPosition } from 'typescript-parsec';

import { SourceSpan } from './source-span.js';
import { CommentTrivia, TriviaItem } from './trivia.js';

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
  Equal,
  NotEqual,
  LessThan,
  LessThanOrEqual,
  GreaterThan,
  GreaterThanOrEqual,

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
  Unknown,
}

export interface RichToken extends Token<TokenKind> {
  readonly kind: TokenKind;
  readonly text: string;
  readonly pos: TokenPosition;
  readonly span: SourceSpan;
  readonly leadingTrivia: readonly TriviaItem[];
  readonly trailingComment: CommentTrivia | null;
  readonly hasLeadingNewline: boolean;
  readonly prev: RichToken | undefined;
  readonly next: RichToken | undefined;
}
