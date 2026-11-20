import { RichToken } from '../../token.js';
import { AmountCst } from '../amount.js';
import { CstNodeCommon } from '../common.js';
import { DateCst } from '../date.js';
import { DirectiveCommonCst } from '../directive.js';
import { ExpressionCst } from '../expression.js';

export interface BalanceEntryCst extends CstNodeCommon {
  readonly type: 'balance-entry';
  readonly accountToken: RichToken;
  readonly amount: AmountCst;
  readonly approx: {
    readonly tildeToken: RichToken;
    readonly tolerance: ExpressionCst;
  } | null;
}

export interface BalanceDirectiveCst<
  TBalanceEntry = BalanceEntryCst,
> extends DirectiveCommonCst<'balance'> {
  readonly date: DateCst;
  readonly keywordToken: RichToken;
  readonly balances: readonly TBalanceEntry[];
}
