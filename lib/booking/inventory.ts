import { strict as assert } from 'node:assert';

import { Map, Record, RecordOf, Seq, Set } from 'immutable';
import { inspect, InspectOptionsStylized } from 'util';

import { Amount } from '../core/amount.js';
import { Position } from './position.js';

type AmountRecordProps = {
  readonly amount: string;
  readonly currency: string;
};
type AmountRecord = RecordOf<AmountRecordProps>;
const makeAmountRecord = Record<AmountRecordProps>({
  amount: '',
  currency: '',
});

type CostRecordProps = {
  readonly amounts: Set<AmountRecord>;
  readonly timestamp: number;
};

type CostRecord = RecordOf<CostRecordProps>;
const makeCostRecord = Record<CostRecordProps>({
  amounts: Set(),
  timestamp: 0,
});

// Inventory for a single currency
class CurrencyInventory {
  public static readonly Empty = new CurrencyInventory(Map());

  private constructor(
    private readonly positions: Map<CostRecord | null, Position>,
  ) {}

  isZero(): boolean {
    return this.positions.isEmpty();
  }

  getPositions(): Position[] {
    return this.positions.valueSeq().toArray();
  }

  addPosition(position: Position): CurrencyInventory {
    // Caller handles zero.
    assert(!position.amount.isZero());

    const key =
      position.cost === null
        ? null
        : makeCostRecord({
            amounts: Set(
              position.cost.amounts.map(amount =>
                makeAmountRecord({
                  amount: amount.amount.toFraction(),
                  currency: amount.currency,
                }),
              ),
            ),
            timestamp: position.cost.date.getTime(),
          });

    const cur = this.positions.get(key);
    if (cur === undefined) {
      return new CurrencyInventory(this.positions.set(key, position));
    }

    const newPosition = new Position(
      cur.amount.add(position.amount),
      position.cost,
    );
    if (newPosition.amount.isZero()) {
      return new CurrencyInventory(this.positions.delete(key));
    }

    return new CurrencyInventory(this.positions.set(key, newPosition));
  }
}

export class Inventory {
  public static readonly Empty = new Inventory(Map());

  private constructor(
    // Map from currency to its inventory
    private readonly inventories: Map<string, CurrencyInventory>,
  ) {}

  /**
   * Checks if the inventory is empty.
   *
   * @returns true if the inventory has no positions, otherwise false.
   */
  isEmpty(): boolean {
    return this.inventories.isEmpty();
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
    return this.addPositions(amounts.map(amount => new Position(amount, null)));
  }

  /**
   * Adds a position to the current inventory.
   *
   * @param position Position to add to the current inventory.
   * @returns A new inventory with the added position.
   */
  addPosition(position: Position): Inventory {
    return this.addPositions([position]);
  }

  /**
   * Adds positions to the current inventory.
   *
   * @param positions Positions to add to the current inventory.
   * @returns A new inventory with the added positions.
   */
  addPositions(positions: readonly Position[]): Inventory {
    const newInventories = this.inventories.withMutations(newInventories => {
      for (const position of positions) {
        if (position.amount.isZero()) {
          continue;
        }

        const currency = position.amount.currency;
        const curInventory =
          newInventories.get(currency) ?? CurrencyInventory.Empty;
        const newInventory = curInventory.addPosition(position);

        if (newInventory.isZero()) {
          newInventories.delete(currency);
        } else {
          newInventories.set(currency, newInventory);
        }
      }
    });

    return new Inventory(newInventories);
  }

  /**
   * Returns the current positions in the inventory.
   */
  getPositions(): Position[] {
    return this.inventories
      .valueSeq()
      .flatMap(x => x.getPositions())
      .toArray();
  }

  toString() {
    return this.inventories
      .entrySeq()
      .sortBy(([currency]) => currency)
      .flatMap(([, inventory]) =>
        Seq(inventory.getPositions())
          .sortBy(x => x.cost?.date.getTime() ?? 0)
          .map(x => x.toString()),
      )
      .join('\n');
  }

  [inspect.custom](_depth: number, options: InspectOptionsStylized) {
    return inspect(
      this.inventories
        .entrySeq()
        .sortBy(([currency]) => currency)
        .flatMap(([, inventory]) =>
          Seq(inventory.getPositions()).sortBy(
            x => x.cost?.date.getTime() ?? 0,
          ),
        )
        .toArray(),
      options,
    );
  }
}

export type InventoryMap = Map<string, Inventory>;
