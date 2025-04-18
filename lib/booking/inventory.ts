import { Map } from 'immutable';
import { inspect, InspectOptionsStylized } from 'util';

import { Amount } from '../core/amount.js';

export class Inventory {
  public static readonly Empty = new Inventory(Map());

  private constructor(
    // Map from currency to amount
    private readonly amounts: Map<string, Amount>,
  ) {}

  /**
   * Checks if the inventory is empty.
   *
   * @returns true if the inventory has no amounts, otherwise false.
   */
  isEmpty(): boolean {
    return this.amounts.isEmpty();
  }

  /**
   * Adds an amount to the current inventory.
   *
   * @param amount Amount to add to the current inventory.
   * @returns A new inventory with the added amount.
   */
  addAmount(amount: Amount): Inventory {
    return this.addAmounts([amount]);
  }

  /**
   * Adds amounts to the current inventory.
   *
   * @param amounts Amounts to add to the current inventory.
   * @returns A new inventory with the added amounts.
   */
  addAmounts(amounts: readonly Amount[]): Inventory {
    const newAmounts = this.amounts.withMutations(newAmounts => {
      for (const amount of amounts) {
        if (amount.isZero()) {
          continue;
        }

        const currency = amount.currency;
        const curAmount = newAmounts.get(currency) ?? Amount.zero(currency);
        const newAmount = curAmount.add(amount);

        if (newAmount.isZero()) {
          newAmounts.delete(currency);
        } else {
          newAmounts.set(currency, newAmount);
        }
      }
    });

    return new Inventory(newAmounts);
  }

  /**
   * Returns the current amounts in the inventory.
   */
  getAmounts(): Amount[] {
    return this.amounts.valueSeq().toArray();
  }

  toString() {
    return this.amounts
      .entrySeq()
      .sortBy(([currency]) => currency)
      .map(([, value]) => value.toString())
      .join('\n');
  }

  [inspect.custom](_depth: number, options: InspectOptionsStylized) {
    return inspect(
      this.amounts
        .entrySeq()
        .sortBy(([currency]) => currency)
        .map(([, value]) => value)
        .toArray(),
      options,
    );
  }
}

export type InventoryMap = Map<string, Inventory>;
