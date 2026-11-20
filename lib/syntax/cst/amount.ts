import { RichToken } from '../token.js';
import { CstNodeCommon } from './common.js';
import { ExpressionCst } from './expression.js';

export interface AmountCst extends CstNodeCommon {
  readonly amount: ExpressionCst;
  readonly currencyToken: RichToken;
}
