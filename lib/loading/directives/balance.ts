import { ExactNumberType as N } from 'exactnumber';

import { Amount } from '../../core/amount.js';
import { DirectiveCommon } from '../directive.js';

export interface BalanceDirective extends DirectiveCommon<'balance'> {
  readonly balances: ReadonlyArray<{
    readonly account: string;
    readonly amount: Amount;
    readonly approx: N | null;
  }>;
}
