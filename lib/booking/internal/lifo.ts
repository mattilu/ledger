import { either as E } from 'fp-ts';

import { Amount } from '../../core/amount.js';
import { Metadata } from '../../loading/metadata.js';
import { makeHeap, popHeap } from '../../utils/heap.js';
import { Cost } from '../cost.js';
import { Inventory } from '../inventory.js';
import { Position } from '../position.js';
import { BookedPosting } from '../transaction.js';
import { BookingMethod } from './booking-method.js';

type PositionWithCost = Position & { readonly cost: Cost };

const cmp = (a: PositionWithCost, b: PositionWithCost): boolean =>
  a.cost.date.getTime() < b.cost.date.getTime();

/**
 * Implements the LIFO booking method: reduces newest matching positions first.
 */
class LifoBookingMethod implements BookingMethod {
  book(
    account: string,
    flag: string,
    meta: Metadata,
    amount: Amount,
    inventory: Inventory,
  ): E.Either<Error, [postings: BookedPosting[], newInventory: Inventory]> {
    const postings: BookedPosting[] = [];

    const positions = inventory
      .getPositionsForCurrency(amount.currency)
      .filter(x => x.cost !== null) as PositionWithCost[];

    // Heapify so newest position is at the top of the heap.
    makeHeap(positions, cmp);

    while (!amount.isZero()) {
      if (positions.length === 0) {
        return E.left(
          new Error(
            `Not enough positions to reduce: ${amount} from ${account}`,
          ),
        );
      }

      // Pop the newest position
      popHeap(positions, cmp);
      const position = positions.pop()!;

      if (position.amount.isPos() === amount.isPos()) {
        // Not a reduction, next!
        continue;
      }

      // If position is smaller than the amount we need to reduce, take the
      // whole position, otherwise only reduce the amount left.
      const toAdd = position.amount.abs().lte(amount.abs())
        ? position.amount.neg()
        : amount;

      const positionToAdd = new Position(toAdd, position.cost);

      inventory = inventory.addPosition(positionToAdd);
      postings.push({
        account,
        flag,
        amount: positionToAdd.amount,
        cost: positionToAdd.cost,
        meta,
      });

      amount = amount.sub(toAdd);
    }

    return E.right([postings, inventory]);
  }
}

export const LIFO: BookingMethod = new LifoBookingMethod();
