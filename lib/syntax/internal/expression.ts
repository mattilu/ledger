import { alt_sc, apply, Parser, rule, seq, tok } from 'typescript-parsec';

import { ExpressionCst } from '../cst/expression.js';
import { TokenKind } from '../token.js';
import { lrec_sc } from './combinators.js';
import { asRichToken, spanFromNodes, spanFromRange } from './source-span.js';

const MAX_EXPRESSION_DEPTH = 256;

const term = rule<TokenKind, ExpressionCst>();
const factor = rule<TokenKind, ExpressionCst>();
const expression = rule<TokenKind, ExpressionCst>();

let expressionDepth = 0;

const termPattern: Parser<TokenKind, ExpressionCst> = alt_sc(
  apply(tok(TokenKind.NumberLiteral), (token, range): ExpressionCst => ({
    type: 'literal',
    token: asRichToken(token),
    span: spanFromRange(range),
  })),
  apply(
    seq(alt_sc(tok(TokenKind.Plus), tok(TokenKind.Minus)), term),
    ([opToken, expr], range): ExpressionCst => ({
      type: 'unary',
      op: opToken.kind === TokenKind.Plus ? '+' : '-',
      opToken: asRichToken(opToken),
      expr,
      span: spanFromRange(range),
    }),
  ),
  apply(
    seq(tok(TokenKind.OpenParen), expression, tok(TokenKind.CloseParen)),
    ([openParen, expr, closeParen], range): ExpressionCst => ({
      type: 'paren',
      openParen: asRichToken(openParen),
      expr,
      closeParen: asRichToken(closeParen),
      span: spanFromRange(range),
    }),
  ),
);

term.setPattern({
  parse(token) {
    if (expressionDepth >= MAX_EXPRESSION_DEPTH) {
      return {
        successful: false,
        error: {
          kind: 'Error',
          pos: token?.pos,
          message: `Maximum expression nesting depth (${MAX_EXPRESSION_DEPTH}) exceeded`,
        },
      };
    }
    expressionDepth++;
    try {
      return termPattern.parse(token);
    } finally {
      expressionDepth--;
    }
  },
});

factor.setPattern(
  lrec_sc(
    term,
    seq(alt_sc(tok(TokenKind.Times), tok(TokenKind.Divide)), term),
    (lhs, [opToken, rhs]): ExpressionCst => ({
      type: 'binary',
      op: opToken.kind === TokenKind.Times ? '*' : '/',
      opToken: asRichToken(opToken),
      lhs,
      rhs,
      span: spanFromNodes(lhs, rhs),
    }),
  ),
);

expression.setPattern(
  lrec_sc(
    factor,
    seq(alt_sc(tok(TokenKind.Plus), tok(TokenKind.Minus)), factor),
    (lhs, [opToken, rhs]): ExpressionCst => ({
      type: 'binary',
      op: opToken.kind === TokenKind.Plus ? '+' : '-',
      opToken: asRichToken(opToken),
      lhs,
      rhs,
      span: spanFromNodes(lhs, rhs),
    }),
  ),
);

export const expressionCstParser: Parser<TokenKind, ExpressionCst> = expression;
