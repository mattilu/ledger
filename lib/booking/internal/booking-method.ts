import { either as E } from 'fp-ts';

import { Amount } from '../../core/amount.js';
import { Inventory } from '../inventory.js';
import { BookedPosting } from '../transaction.js';

/**
 * Interface to be implemented by booking methods (e.g. FIFO, LIFO, etc.)
 */
export interface BookingMethod {
  /**
   * Books an amount to the account, and returns the generated postings and new
   * state of the inventory.
   *
   * @param account The account to be booked.
   * @param flag Flag to be used for the posting. Implementation is not required
   *   to use this.
   * @param amount Amount to be booked.
   * @param inventory Current state of the inventory for the account.
   * @returns A pair of [postings, newInventory].
   */
  book(
    account: string,
    flag: string,
    amount: Amount,
    inventory: Inventory,
  ): E.Either<Error, [postings: BookedPosting[], newInventory: Inventory]>;
}
