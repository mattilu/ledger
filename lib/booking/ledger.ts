import { Map } from 'immutable';

import { SignConvention } from '../core/sign-convention.js';
import { CurrencyDirective } from '../loading/directives/currency.js';
import { PriceDirective } from '../loading/directives/price.js';
import { AccountMap } from '../loading/ledger.js';
import { InventoryMap } from './inventory.js';
import { Transaction } from './transaction.js';

export interface BookedLedger {
  /** List of booked transactions. */
  readonly transactions: readonly Transaction[];
  /** List of price directives, both from user and synthetic. */
  readonly prices: readonly PriceDirective[];
  /** Map from currency name to its defining directive. */
  readonly currencyMap: Map<string, CurrencyDirective>;
  /** State of accounts at the end of booking. */
  readonly accountMap: AccountMap;
  /** State of inventories at the end of booking. */
  readonly inventories: InventoryMap;
  /** Active sign convention. */
  readonly signConvention: SignConvention;
}
