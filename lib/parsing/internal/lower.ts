import { ExactNumber, ExactNumberType } from 'exactnumber';
import { Map } from 'immutable';

import { AmountCst } from '../../syntax/cst/amount.js';
import {
  ConditionExpressionCst,
  ConditionLiteralCst,
} from '../../syntax/cst/condition.js';
import { DateCst } from '../../syntax/cst/date.js';
import { DirectiveCst } from '../../syntax/cst/directive.js';
import {
  AccountChoiceOtherwiseOutcomeCst,
  AccountChoiceOutcomeCst,
  RuleClauseCst,
} from '../../syntax/cst/directives/account-rule.js';
import {
  CostSpecCst,
  PostingCst,
  PriceSpecCst,
} from '../../syntax/cst/directives/transaction.js';
import { ExpressionCst } from '../../syntax/cst/expression.js';
import { SyntaxTree } from '../../syntax/cst/ledger.js';
import {
  MetadataEntryCst,
  MetadataValueCst,
} from '../../syntax/cst/metadata.js';
import { SourceSpan } from '../../syntax/source-span.js';
import { RichToken } from '../../syntax/token.js';
import { SourcePosition } from '../source-position.js';
import { AmountSpec } from '../spec/amount.js';
import { ConditionExpression, ConditionLiteral } from '../spec/condition.js';
import { DateSpec } from '../spec/date.js';
import { DirectiveSpec } from '../spec/directive.js';
import {
  AccountChoiceOtherwiseOutcome,
  AccountChoiceOutcome,
  AccountChoiceRule,
} from '../spec/directives/account-rule.js';
import {
  CostSpec,
  PostingSpec,
  PriceSpec,
} from '../spec/directives/transaction.js';
import { Expression } from '../spec/expression.js';
import { LedgerSpec } from '../spec/ledger.js';
import { MetadataSpec, MetadataValueSpec } from '../spec/metadata.js';

class LiteralValue {
  readonly type = 'literal';
  constructor(readonly value: ExactNumberType) {}

  toJSON() {
    return { type: this.type, value: this.value.toString() };
  }
}

class DurationValue {
  readonly type = 'duration';
  readonly unit = 'd';
  constructor(readonly value: ExactNumberType) {}

  toJSON() {
    return { type: this.type, value: this.value.toString(), unit: this.unit };
  }
}

function unquoteString(token: RichToken): string {
  return token.text.slice(1, -1);
}

function parseExactNumber(token: RichToken): ExactNumberType {
  return ExactNumber(token.text.replaceAll(',', ''));
}

function spanToSourcePosition(span: SourceSpan): SourcePosition {
  return {
    row: span.start.row,
    col: span.start.col,
  };
}

function lowerDate(date: DateCst): DateSpec {
  return {
    date: date.dateToken.text,
    time: date.timeToken?.text ?? null,
    timezone: date.timezoneToken?.text ?? null,
  };
}

function lowerExpression(expr: ExpressionCst): Expression {
  switch (expr.type) {
    case 'literal':
      return new LiteralValue(parseExactNumber(expr.token));
    case 'paren':
      return lowerExpression(expr.expr);
    case 'unary':
      return {
        type: 'unary',
        op: expr.op,
        expr: lowerExpression(expr.expr),
      };
    case 'binary': {
      const chain: {
        readonly op: '+' | '-' | '*' | '/';
        readonly rhs: ExpressionCst;
      }[] = [];
      let cur: ExpressionCst = expr;
      while (cur.type === 'binary') {
        chain.push({ op: cur.op, rhs: cur.rhs });
        cur = cur.lhs;
      }
      let result = lowerExpression(cur);
      for (let i = chain.length - 1; i >= 0; i--) {
        result = {
          type: 'binary',
          op: chain[i].op,
          expr1: result,
          expr2: lowerExpression(chain[i].rhs),
        };
      }
      return result;
    }
  }
}

function lowerAmount(amount: AmountCst): AmountSpec {
  return {
    amount: lowerExpression(amount.amount),
    currency: amount.currencyToken.text,
  };
}

function lowerMetadataValue(value: MetadataValueCst): MetadataValueSpec {
  switch (value.type) {
    case 'string':
      return { type: 'string', value: unquoteString(value.token) };
    case 'account':
      return { type: 'account', value: value.token.text };
    case 'currency':
      return { type: 'currency', value: value.token.text };
    case 'date':
      return { type: 'date', value: lowerDate(value.date) };
    case 'amount':
      return { type: 'amount', value: lowerAmount(value.amount) };
    case 'number':
      return { type: 'number', value: lowerExpression(value.expr) };
  }
}

function lowerMetadata(entries: readonly MetadataEntryCst[]): MetadataSpec {
  return Map(
    entries.map(entry => [
      entry.keyToken.text,
      lowerMetadataValue(entry.value),
    ]),
  );
}

function lowerConditionLiteral(literal: ConditionLiteralCst): ConditionLiteral {
  switch (literal.type) {
    case 'identifier':
      return { type: 'identifier', value: literal.token.text };
    case 'string':
      return { type: 'string', value: unquoteString(literal.token) };
    case 'number':
      return { type: 'number', value: lowerExpression(literal.expr) };
    case 'amount':
      return { type: 'amount', value: lowerAmount(literal.amount) };
    case 'date':
      return { type: 'date', value: lowerDate(literal.date) };
    case 'account':
      return { type: 'account', value: literal.token.text };
    case 'currency':
      return { type: 'currency', value: literal.token.text };
    case 'duration':
      return new DurationValue(parseExactNumber(literal.valueToken));
  }
}

function lowerCondition(
  condition: ConditionExpressionCst,
): ConditionExpression {
  switch (condition.type) {
    case 'comparison':
      return {
        type: 'comparison',
        attribute: condition.attributeToken.text,
        operator: condition.operator.operator,
        value: lowerConditionLiteral(condition.value),
      };
    case 'paren':
      return lowerCondition(condition.expr);
    case 'not':
      return { type: 'not', expr: lowerCondition(condition.expr) };
    case 'and':
    case 'or': {
      const chain: {
        readonly op: 'and' | 'or';
        readonly rhs: ConditionExpressionCst;
      }[] = [];
      let cur: ConditionExpressionCst = condition;
      while (cur.type === 'and' || cur.type === 'or') {
        chain.push({ op: cur.type, rhs: cur.rhs });
        cur = cur.lhs;
      }
      let result = lowerCondition(cur);
      for (let i = chain.length - 1; i >= 0; i--) {
        result = {
          type: chain[i].op,
          lhs: result,
          rhs: lowerCondition(chain[i].rhs),
        };
      }
      return result;
    }
  }
}

function lowerOtherwiseOutcome(
  outcome: AccountChoiceOtherwiseOutcomeCst,
): AccountChoiceOtherwiseOutcome {
  switch (outcome.type) {
    case 'account':
      return { type: 'account', account: outcome.accountToken.text };
    case 'fail':
      return {
        type: 'fail',
        message: outcome.messageToken
          ? unquoteString(outcome.messageToken)
          : null,
      };
  }
}

function lowerWhenOutcome(
  outcome: AccountChoiceOutcomeCst,
): AccountChoiceOutcome {
  if (outcome.type === 'break') {
    return { type: 'break' };
  }
  return lowerOtherwiseOutcome(outcome);
}

function lowerRuleClause(clause: RuleClauseCst): AccountChoiceRule {
  switch (clause.type) {
    case 'when':
      return {
        type: 'when',
        condition: lowerCondition(clause.condition),
        outcome: lowerWhenOutcome(clause.outcome),
      };
    case 'otherwise':
      return {
        type: 'otherwise',
        outcome: lowerOtherwiseOutcome(clause.outcome),
      };
  }
}

function lowerCostSpec(costSpec: CostSpecCst): CostSpec {
  const amounts: AmountSpec[] = [];
  const currencies: string[] = [];
  const dates: DateSpec[] = [];
  const tags: string[] = [];

  for (const item of costSpec.items) {
    switch (item.value.kind) {
      case 'amount':
        amounts.push(lowerAmount(item.value.amount));
        break;
      case 'currency':
        currencies.push(item.value.token.text);
        break;
      case 'date':
        dates.push(lowerDate(item.value.date));
        break;
      case 'tag':
        tags.push(unquoteString(item.value.token));
        break;
    }
  }

  return {
    kind: costSpec.kind,
    amounts,
    currencies,
    dates,
    tags,
  };
}

function lowerPriceSpec(priceSpec: PriceSpecCst): PriceSpec {
  return {
    kind: priceSpec.kind,
    amount: lowerAmount(priceSpec.amount),
  };
}

function lowerPosting(posting: PostingCst): PostingSpec {
  switch (posting.type) {
    case 'account-posting':
      return {
        account: posting.accountToken.text,
        flag: posting.flagToken?.text ?? null,
        amount: posting.amount ? lowerAmount(posting.amount) : null,
        costSpec: posting.costSpec ? lowerCostSpec(posting.costSpec) : null,
        priceSpec: posting.priceSpec ? lowerPriceSpec(posting.priceSpec) : null,
        meta: lowerMetadata(posting.metadata),
      };
    case 'account-choice-posting':
      return {
        account:
          posting.target.type === 'inline'
            ? {
                type: 'inline',
                rules: posting.target.block.clauses.map(lowerRuleClause),
              }
            : {
                type: 'ref',
                name: unquoteString(posting.target.nameToken),
              },
        flag: posting.flagToken?.text ?? null,
        meta: lowerMetadata(posting.metadata),
      };
  }
}

function lowerDirective(directive: DirectiveCst): DirectiveSpec {
  const srcPos = spanToSourcePosition(directive.span);
  const meta = lowerMetadata(directive.metadata);

  switch (directive.type) {
    case 'account-rule':
      return {
        type: 'account-rule',
        name: unquoteString(directive.nameToken),
        rules: directive.block.clauses.map(lowerRuleClause),
        meta,
        srcPos,
      };
    case 'balance':
      return {
        type: 'balance',
        date: lowerDate(directive.date),
        meta,
        balances: directive.balances.map(entry => ({
          account: entry.accountToken.text,
          amount: lowerAmount(entry.amount),
          approx: entry.approx ? lowerExpression(entry.approx.tolerance) : null,
        })),
        srcPos,
      };
    case 'close':
      return {
        type: 'close',
        date: lowerDate(directive.date),
        account: directive.accountToken.text,
        meta,
        srcPos,
      };
    case 'currency':
    case 'commodity':
      return {
        type: directive.type,
        date: lowerDate(directive.date),
        currency: directive.currencyToken.text,
        meta,
        srcPos,
      };
    case 'load':
      return {
        type: 'load',
        path: unquoteString(directive.pathToken),
        meta,
        srcPos,
      };
    case 'open':
      return {
        type: 'open',
        date: lowerDate(directive.date),
        account: directive.accountToken.text,
        currencies: directive.currencyTokens.map(t => t.text),
        meta,
        srcPos,
      };
    case 'option':
      return {
        type: 'option',
        optionName: unquoteString(directive.nameToken),
        optionValue: unquoteString(directive.valueToken),
        meta,
        srcPos,
      };
    case 'price':
      return {
        type: 'price',
        date: lowerDate(directive.date),
        currency: directive.currencyToken.text,
        price: lowerAmount(directive.price),
        meta,
        srcPos,
      };
    case 'transaction':
      return {
        type: 'transaction',
        date: lowerDate(directive.date),
        description: unquoteString(directive.descriptionToken),
        flag: directive.flagToken.text === '!' ? '!' : '*',
        meta,
        postings: directive.postings.map(lowerPosting),
        srcPos,
      };
  }
}

/**
 * Lowers a lossless `SyntaxTree` CST into a semantic `LedgerSpec` AST.
 *
 * @param tree Concrete syntax tree to lower.
 * @returns The lowered `LedgerSpec`.
 */
export function lowerSyntaxTree(tree: SyntaxTree): LedgerSpec {
  return {
    directives: tree.directives.map(lowerDirective),
  };
}
