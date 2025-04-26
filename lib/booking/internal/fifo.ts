import { Either, left, right } from 'fp-ts/lib/Either.js';

import { Amount } from '../../core/amount.js';
import { makeHeap, popHeap } from '../../utils/heap.js';
import { Cost } from '../cost.js';
import { Inventory } from '../inventory.js';
import { Position } from '../position.js';
import { BookedPosting } from '../transaction.js';
import { BookingMethod } from './booking-method.js';

type PositionWithCost = Position & { readonly cost: Cost };

const cmp = (a: PositionWithCost, b: PositionWithCost): boolean =>
  a.cost.date.getTime() > b.cost.date.getTime();

/**
 * Implements the FIFO booking method: reduces oldest matching positions first.
 */
class FifoBookingMethod implements BookingMethod {
  book(
    account: string,
    amount: Amount,
    inventory: Inventory,
  ): Either<Error, [postings: BookedPosting[], newInventory: Inventory]> {
    const postings: BookedPosting[] = [];

    const positions = inventory
      .getPositionsForCurrency(amount.currency)
      .filter(x => x.cost !== null) as PositionWithCost[];

    // Heapify so oldest position is at the top of the heap.
    makeHeap(positions, cmp);

    while (!amount.isZero()) {
      if (positions.length === 0) {
        return left(
          new Error(
            `Not enough positions to reduce: ${amount} from ${account}`,
          ),
        );
      }

      // Pop the oldest position
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

      // Post the reduction at cost, and the corresponding cost, negated.
      // For example, if position was:
      //
      //  -100 USD { 1.2 CHF }
      //
      // And we were trying to reduce it by 60 USD, we would post:
      //
      //    60 USD { 1.2 CHF }
      //   -72 CHF
      //
      // And if we got 80 CHF for the sale, then our PnL would be 8 CHF:
      //
      //   Assets:Broker   -60 USD {}
      //   Trading:Default  60 USD { 1.2 CHF }
      //   Trading:Default -72 CHF
      //   Assets:Broker    80 CHF
      //   Income:Trading ; -8 CHF, inferred
      //
      const positionsToAdd = [
        new Position(toAdd, position.cost),
        ...position.cost.amounts.map(
          cost => new Position(cost.mul(toAdd.amount).neg(), null),
        ),
      ];

      inventory = inventory.addPositions(positionsToAdd);
      postings.push(
        ...positionsToAdd.map(
          (position): BookedPosting => ({
            account,
            amount: position.amount,
            cost: position.cost,
          }),
        ),
      );

      amount = amount.sub(toAdd);
    }

    return right([postings, inventory]);
  }
}

export const FIFO: BookingMethod = new FifoBookingMethod();
