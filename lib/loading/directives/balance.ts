import { ExactNumberType as N } from 'exactnumber';

import { NormalBalanceSide } from '../../core/account.js';
import { Amount } from '../../core/amount.js';
import { SignConvention } from '../../core/sign-convention.js';
import { DirectiveCommon } from '../directive.js';

export interface BalanceEntry {
  readonly account: string;
  readonly amount: Amount;
  readonly approx: N | null;
  readonly normalBalanceSide: NormalBalanceSide;
}

export interface BalanceDirective extends DirectiveCommon<'balance'> {
  readonly balances: readonly BalanceEntry[];
  readonly signConvention: SignConvention;
}
