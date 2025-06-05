import { ExactNumberType } from 'exactnumber';
import {
  alt_sc,
  apply,
  kmid,
  lrec_sc,
  Parser,
  rule,
  seq,
  tok,
} from 'typescript-parsec';

import { Expression } from '../spec/expression.js';
import { numberParser } from './number.js';
import { TokenKind } from './tokenizer.js';

const term = rule<TokenKind, Expression>();
const factor = rule<TokenKind, Expression>();
const expression = rule<TokenKind, Expression>();

// Wrapping in a class with toJSON to avoid serialization errors in tests which
// would otherwise require recursively cleaning up the AST.
class LiteralValue {
  readonly type = 'literal';
  constructor(readonly value: ExactNumberType) {}

  toJSON() {
    return { type: this.type, value: this.value.toString() };
  }
}

term.setPattern(
  alt_sc(
    apply(numberParser, value => new LiteralValue(value)),
    apply(
      seq(alt_sc(tok(TokenKind.Plus), tok(TokenKind.Minus)), term),
      ([token, expr]) => ({
        type: 'unary',
        op: token.kind === TokenKind.Plus ? '+' : '-',
        expr,
      }),
    ),
    kmid(tok(TokenKind.OpenParen), expression, tok(TokenKind.CloseParen)),
  ),
);

factor.setPattern(
  lrec_sc(
    term,
    seq(alt_sc(tok(TokenKind.Times), tok(TokenKind.Divide)), term),
    (expr1, [token, expr2]) => ({
      type: 'binary',
      op: token.kind === TokenKind.Times ? '*' : '/',
      expr1,
      expr2,
    }),
  ),
);

expression.setPattern(
  lrec_sc(
    factor,
    seq(alt_sc(tok(TokenKind.Plus), tok(TokenKind.Minus)), factor),
    (expr1, [token, expr2]) => ({
      type: 'binary',
      op: token.kind === TokenKind.Plus ? '+' : '-',
      expr1,
      expr2,
    }),
  ),
);

export const expressionParser: Parser<TokenKind, Expression> = expression;
