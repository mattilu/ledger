import { Map } from 'immutable';

import { CloseDirective } from '../loading/directives/close.js';
import { OpenDirective } from '../loading/directives/open.js';
import { InventoryMap } from './inventory.js';
import { Transaction } from './transaction.js';

export type AccountMap = Map<string, OpenDirective | CloseDirective>;

export interface BookedLedger {
  readonly transactions: Transaction[];
  readonly accountMap: AccountMap;
  readonly inventories: InventoryMap;
}
