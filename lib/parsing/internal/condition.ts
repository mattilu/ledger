import { ExactNumberType } from 'exactnumber';
import {
  alt_sc,
  apply,
  combine,
  fail,
  kmid,
  kright,
  lrec_sc,
  Parser,
  rule,
  seq,
  str,
  succ,
  tok,
} from 'typescript-parsec';

import { ConditionExpression, ConditionLiteral } from '../spec/condition.js';
import { accountParser } from './account.js';
import { amountParser } from './amount.js';
import { currencyParser } from './currency.js';
import { dateParser } from './date.js';
import { expressionParser } from './expression.js';
import { numberParser } from './number.js';
import { stringParser } from './string.js';
import { TokenKind } from './tokenizer.js';

const RESERVED_KEYWRODS = ['and', 'or', 'not', 'is'];
const conditionIdentifierParser = combine(tok(TokenKind.Identifier), tok =>
  RESERVED_KEYWRODS.includes(tok.text)
    ? fail(`Unexpected reserved keyword: ${tok.text}`)
    : succ(tok.text),
);

// Wrap in a class with toJSON to avoid serialization errors in tests which
// would otherwise require recursively cleaning up the AST.
class DurationValue {
  readonly type = 'duration';
  readonly unit = 'd';
  constructor(readonly value: ExactNumberType) {}

  toJSON() {
    return { type: this.type, value: this.value.toString(), unit: this.unit };
  }
}

const durationParser = apply(
  seq(numberParser, str('d')),
  ([value]) => new DurationValue(value),
);

const conditionLiteralParser: Parser<TokenKind, ConditionLiteral> = alt_sc(
  apply(stringParser, value => ({ type: 'string', value })),
  apply(dateParser, value => ({ type: 'date', value })),
  apply(amountParser, value => ({ type: 'amount', value })),
  apply(accountParser, value => ({ type: 'account', value })),
  apply(currencyParser, value => ({ type: 'currency', value })),
  durationParser,
  apply(expressionParser, value => ({ type: 'number', value })),
  apply(conditionIdentifierParser, value => ({ type: 'identifier', value })),
);

const comparisonOperatorParser = alt_sc(
  apply(tok(TokenKind.Equal), () => '==' as const),
  apply(tok(TokenKind.NotEqual), () => '!=' as const),
  apply(tok(TokenKind.LessThanOrEqual), () => '<=' as const),
  apply(tok(TokenKind.LessThan), () => '<' as const),
  apply(tok(TokenKind.GreaterThanOrEqual), () => '>=' as const),
  apply(tok(TokenKind.GreaterThan), () => '>' as const),
  apply(seq(str('is'), str('not')), () => 'is not' as const),
  apply(str('is'), () => 'is' as const),
);

const condition = rule<TokenKind, ConditionExpression>();
const comparisonExpression = apply(
  seq(
    conditionIdentifierParser,
    comparisonOperatorParser,
    conditionLiteralParser,
  ),
  ([attribute, operator, value]): ConditionExpression => ({
    type: 'comparison',
    attribute,
    operator,
    value,
  }),
);

const primaryExpression = alt_sc(
  comparisonExpression,
  kmid(tok(TokenKind.OpenParen), condition, tok(TokenKind.CloseParen)),
);

const notExpression = rule<TokenKind, ConditionExpression>();
notExpression.setPattern(
  alt_sc(
    apply(
      kright(str('not'), notExpression),
      (expr): ConditionExpression => ({ type: 'not', expr }),
    ),
    primaryExpression,
  ),
);

const andExpression = lrec_sc(
  notExpression,
  kright(str('and'), notExpression),
  (lhs, rhs): ConditionExpression => ({ type: 'and', lhs, rhs }),
);

const orExpression = lrec_sc(
  andExpression,
  kright(str('or'), andExpression),
  (lhs, rhs): ConditionExpression => ({ type: 'or', lhs, rhs }),
);

condition.setPattern(orExpression);

export const conditionParser: Parser<TokenKind, ConditionExpression> =
  condition;
