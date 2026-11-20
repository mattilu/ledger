import {
  ConditionExpressionCst,
  ConditionLiteralCst,
} from '../../syntax/cst/condition.js';
import { DateCst } from '../../syntax/cst/date.js';
import { DirectiveCst } from '../../syntax/cst/directive.js';
import {
  AccountChoiceOtherwiseOutcomeCst,
  AccountChoiceOutcomeCst,
} from '../../syntax/cst/directives/account-rule.js';
import { CostItemCst } from '../../syntax/cst/directives/transaction.js';
import { ExpressionCst } from '../../syntax/cst/expression.js';
import { MetadataValueCst } from '../../syntax/cst/metadata.js';
import { RichToken } from '../../syntax/token.js';

export function leftmostExpressionToken(root: ExpressionCst): RichToken {
  let cur: ExpressionCst = root;
  for (;;) {
    switch (cur.type) {
      case 'literal':
        return cur.token;
      case 'unary':
        return cur.opToken;
      case 'binary':
        cur = cur.lhs;
        break;
      case 'paren':
        return cur.openParen;
    }
  }
}

export function rightmostExpressionToken(root: ExpressionCst): RichToken {
  let cur: ExpressionCst = root;
  for (;;) {
    switch (cur.type) {
      case 'literal':
        return cur.token;
      case 'unary':
        cur = cur.expr;
        break;
      case 'binary':
        cur = cur.rhs;
        break;
      case 'paren':
        return cur.closeParen;
    }
  }
}

export function rightmostDateToken(date: DateCst): RichToken {
  return date.timezoneToken ?? date.timeToken ?? date.dateToken;
}

export function leftmostCostItemValueToken(
  value: CostItemCst['value'],
): RichToken {
  switch (value.kind) {
    case 'amount':
      return leftmostExpressionToken(value.amount.amount);
    case 'currency':
    case 'tag':
      return value.token;
    case 'date':
      return value.date.dateToken;
  }
}

export function rightmostCostItemValueToken(
  value: CostItemCst['value'],
): RichToken {
  switch (value.kind) {
    case 'amount':
      return value.amount.currencyToken;
    case 'currency':
    case 'tag':
      return value.token;
    case 'date':
      return rightmostDateToken(value.date);
  }
}

export function leftmostConditionToken(
  root: ConditionExpressionCst,
): RichToken {
  let cur: ConditionExpressionCst = root;
  for (;;) {
    switch (cur.type) {
      case 'comparison':
        return cur.attributeToken;
      case 'not':
        return cur.notToken;
      case 'and':
      case 'or':
        cur = cur.lhs;
        break;
      case 'paren':
        return cur.openParen;
    }
  }
}

function rightmostConditionLiteralToken(value: ConditionLiteralCst): RichToken {
  switch (value.type) {
    case 'identifier':
    case 'string':
    case 'account':
    case 'currency':
      return value.token;
    case 'number':
      return rightmostExpressionToken(value.expr);
    case 'amount':
      return value.amount.currencyToken;
    case 'date':
      return rightmostDateToken(value.date);
    case 'duration':
      return value.unitToken;
  }
}

export function rightmostConditionToken(
  root: ConditionExpressionCst,
): RichToken {
  let cur: ConditionExpressionCst = root;
  for (;;) {
    switch (cur.type) {
      case 'comparison':
        return rightmostConditionLiteralToken(cur.value);
      case 'not':
        cur = cur.expr;
        break;
      case 'and':
      case 'or':
        cur = cur.rhs;
        break;
      case 'paren':
        return cur.closeParen;
    }
  }
}

export function rightmostOutcomeToken(
  outcome: AccountChoiceOutcomeCst | AccountChoiceOtherwiseOutcomeCst,
): RichToken {
  switch (outcome.type) {
    case 'account':
      return outcome.accountToken;
    case 'break':
      return outcome.breakToken;
    case 'fail':
      return outcome.messageToken ?? outcome.failToken;
  }
}

export function rightmostMetadataValueToken(
  value: MetadataValueCst,
): RichToken {
  switch (value.type) {
    case 'string':
    case 'account':
    case 'currency':
      return value.token;
    case 'date':
      return rightmostDateToken(value.date);
    case 'amount':
      return value.amount.currencyToken;
    case 'number':
      return rightmostExpressionToken(value.expr);
  }
}

export function firstDirectiveToken(directive: DirectiveCst): RichToken {
  switch (directive.type) {
    case 'account-rule':
    case 'load':
    case 'option':
      return directive.keywordToken;
    case 'balance':
    case 'close':
    case 'currency':
    case 'commodity':
    case 'open':
    case 'price':
    case 'transaction':
      return directive.date.dateToken;
  }
}
