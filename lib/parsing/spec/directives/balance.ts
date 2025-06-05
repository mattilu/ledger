import { AmountSpec } from '../amount.js';
import { DateSpec } from '../date.js';
import { DirectiveCommonSpec } from '../directive.js';

/**
 * Checks that the current balance of an account for a given currency matches
 * the given amount.
 */
export interface BalanceDirectiveSpec extends DirectiveCommonSpec<'balance'> {
  readonly date: DateSpec;
  readonly balances: ReadonlyArray<{
    readonly account: string;
    readonly amount: AmountSpec;
  }>;
}
