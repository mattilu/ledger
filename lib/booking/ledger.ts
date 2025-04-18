import { Transaction } from './transaction.js';

export interface BookedLedger {
  readonly transactions: Transaction[];
}
