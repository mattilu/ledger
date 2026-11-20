import {
  alt_sc,
  apply,
  combine,
  fail,
  lrec_sc,
  Parser,
  rule,
  seq,
  succ,
} from 'typescript-parsec';

import {
  ComparisonOperatorCst,
  ConditionExpressionCst,
  ConditionLiteralCst,
} from '../cst/condition.js';
import { RichToken, TokenKind } from '../token.js';
import { amountCstParser } from './amount.js';
import { dateCstParser } from './date.js';
import { expressionCstParser } from './expression.js';
import { richStr, richTok } from './primitives.js';
import { spanFromNodes, spanFromRange } from './source-span.js';

const RESERVED_KEYWORDS = new Set(['and', 'or', 'not', 'is']);

const conditionIdentifierParser: Parser<TokenKind, RichToken> = combine(
  richTok(TokenKind.Identifier),
  token =>
    RESERVED_KEYWORDS.has(token.text)
      ? fail(`Unexpected reserved keyword: ${token.text}`)
      : succ(token),
);

const durationLiteralParser: Parser<TokenKind, ConditionLiteralCst> = apply(
  seq(richTok(TokenKind.NumberLiteral), richStr('d')),
  ([valueToken, unitToken], range): ConditionLiteralCst => ({
    type: 'duration',
    valueToken,
    unitToken,
    span: spanFromRange(range),
  }),
);

const conditionLiteralCstParser: Parser<TokenKind, ConditionLiteralCst> =
  alt_sc(
    apply(richTok(TokenKind.StringLiteral), token => ({
      type: 'string',
      token,
    })),
    apply(dateCstParser, date => ({
      type: 'date',
      date,
    })),
    apply(amountCstParser, amount => ({
      type: 'amount',
      amount,
    })),
    apply(richTok(TokenKind.Account), token => ({
      type: 'account',
      token,
    })),
    apply(richTok(TokenKind.Currency), token => ({
      type: 'currency',
      token,
    })),
    durationLiteralParser,
    apply(expressionCstParser, expr => ({
      type: 'number',
      expr,
    })),
    apply(conditionIdentifierParser, token => ({
      type: 'identifier',
      token,
    })),
  );

const comparisonOperatorCstParser: Parser<TokenKind, ComparisonOperatorCst> =
  alt_sc(
    apply(richTok(TokenKind.Equal), (tok, range) => ({
      operator: '==' as const,
      tokens: [tok],
      span: spanFromRange(range),
    })),
    apply(richTok(TokenKind.NotEqual), (tok, range) => ({
      operator: '!=' as const,
      tokens: [tok],
      span: spanFromRange(range),
    })),
    apply(richTok(TokenKind.LessThanOrEqual), (tok, range) => ({
      operator: '<=' as const,
      tokens: [tok],
      span: spanFromRange(range),
    })),
    apply(richTok(TokenKind.LessThan), (tok, range) => ({
      operator: '<' as const,
      tokens: [tok],
      span: spanFromRange(range),
    })),
    apply(richTok(TokenKind.GreaterThanOrEqual), (tok, range) => ({
      operator: '>=' as const,
      tokens: [tok],
      span: spanFromRange(range),
    })),
    apply(richTok(TokenKind.GreaterThan), (tok, range) => ({
      operator: '>' as const,
      tokens: [tok],
      span: spanFromRange(range),
    })),
    apply(seq(richStr('is'), richStr('not')), ([isTok, notTok], range) => ({
      operator: 'is not' as const,
      tokens: [isTok, notTok],
      span: spanFromRange(range),
    })),
    apply(richStr('is'), (tok, range) => ({
      operator: 'is' as const,
      tokens: [tok],
      span: spanFromRange(range),
    })),
  );

const condition = rule<TokenKind, ConditionExpressionCst>();

const comparisonExpressionCstParser: Parser<TokenKind, ConditionExpressionCst> =
  apply(
    seq(
      conditionIdentifierParser,
      comparisonOperatorCstParser,
      conditionLiteralCstParser,
    ),
    ([attributeToken, operator, value], range): ConditionExpressionCst => ({
      type: 'comparison',
      attributeToken,
      operator,
      value,
      span: spanFromRange(range),
    }),
  );

const primaryExpressionCstParser: Parser<TokenKind, ConditionExpressionCst> =
  alt_sc(
    comparisonExpressionCstParser,
    apply(
      seq(
        richTok(TokenKind.OpenParen),
        condition,
        richTok(TokenKind.CloseParen),
      ),
      ([openParen, expr, closeParen], range): ConditionExpressionCst => ({
        type: 'paren',
        openParen,
        expr,
        closeParen,
        span: spanFromRange(range),
      }),
    ),
  );

const notExpression = rule<TokenKind, ConditionExpressionCst>();
notExpression.setPattern(
  alt_sc(
    apply(
      seq(richStr('not'), notExpression),
      ([notToken, expr], range): ConditionExpressionCst => ({
        type: 'not',
        notToken,
        expr,
        span: spanFromRange(range),
      }),
    ),
    primaryExpressionCstParser,
  ),
);

const andExpression = lrec_sc(
  notExpression,
  seq(richStr('and'), notExpression),
  (lhs, [opToken, rhs]): ConditionExpressionCst => ({
    type: 'and',
    opToken,
    lhs,
    rhs,
    span: spanFromNodes(lhs, rhs),
  }),
);

const orExpression = lrec_sc(
  andExpression,
  seq(richStr('or'), andExpression),
  (lhs, [opToken, rhs]): ConditionExpressionCst => ({
    type: 'or',
    opToken,
    lhs,
    rhs,
    span: spanFromNodes(lhs, rhs),
  }),
);

condition.setPattern(orExpression);

export const conditionCstParser: Parser<TokenKind, ConditionExpressionCst> =
  condition;
