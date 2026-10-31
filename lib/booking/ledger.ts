import { Map } from 'immutable';

import { CurrencyDirective } from '../loading/directives/currency.js';
import { PriceDirective } from '../loading/directives/price.js';
import { AccountMap } from '../loading/ledger.js';
import { InventoryMap } from './inventory.js';
import { Transaction } from './transaction.js';

export interface BookedLedger {
  readonly transactions: Transaction[];
  readonly prices: PriceDirective[];
  readonly accountMap: AccountMap;
  readonly currencyMap: Map<string, CurrencyDirective>;
  readonly inventories: InventoryMap;
}
