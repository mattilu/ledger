import { Amount } from '../../core/amount.js';
import { DirectiveCommon } from '../directive.js';

export interface BalanceDirective extends DirectiveCommon<'balance'> {
  readonly account: string;
  readonly amount: Amount;
}
