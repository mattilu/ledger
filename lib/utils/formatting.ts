import { ExactNumber } from 'exactnumber';
import { identity } from 'fp-ts/lib/function.js';
import { fst } from 'fp-ts/lib/Tuple.js';
import { Map as ImmutableMap, Seq } from 'immutable';

import { Cost } from '../booking/cost.js';
import { Inventory, InventoryMap } from '../booking/inventory.js';
import { Position } from '../booking/position.js';
import { BookedPosting, Transaction } from '../booking/transaction.js';
import { Amount } from '../core/amount.js';
import { CurrencyDirective } from '../loading/directives/currency.js';
import { formatTree, makeAccountTree } from './internal/account-tree.js';

export interface FormatterOptions {
  readonly currencyMap: ImmutableMap<string, CurrencyDirective>;
}

const ZERO = ExactNumber(0);
const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;
const MILLISECONDS_PER_MINUTE = 1000 * 60;

export enum FormatBalanceMode {
  /** Don't display running balances. */
  None,
  /** Display running balances for individual positions. */
  Full,
  /** Display aggregated running balances instead of individual positions. */
  Aggregate,
}

export type FormatTransactionOptions = {
  /** Determines how running balances are formatted. Defaults to `None`. */
  readonly formatBalance?: FormatBalanceMode;
};

export type FormatInventoriesOptions = {
  /**
   * If true, show the cost of positions held at cost. Otherwise, only show the
   * amount. Defaults to true.
   */
  readonly showCost?: boolean;

  /** If true, format the inventories as a tree. */
  readonly tree?: boolean;

  /**
   * If true, show totals of descendant accounts on each parent.
   * Only effective when `tree` is true.
   **/
  readonly showTotals?: boolean;

  /**
   * Maximum depth of the account tree to display. For elided nodes, their total
   * is shown in the closest non-elided ancestor, regardless of `showTotals`.
   * Only effective when `tree` is true.
   */
  readonly maxDepth?: number;
};

export class Formatter {
  constructor(readonly options: FormatterOptions) {}

  formatDate(date: Date): string {
    const year = date.getUTCFullYear().toString().padStart(4, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');

    if (date.getTime() % MILLISECONDS_PER_DAY === 0) {
      return `${year}-${month}-${day}`;
    }

    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    if (date.getTime() % MILLISECONDS_PER_MINUTE === 0) {
      return `${year}-${month}-${day} ${hours}:${minutes}Z`;
    }

    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}Z`;
  }

  formatAmount(amount: Amount): string {
    const decimals = this.options.currencyMap
      .get(amount.currency)
      ?.meta.get('format-decimals');
    return decimals === undefined || decimals.type !== 'number'
      ? amount.toString()
      : amount.toFixed(decimals.value.toNumber());
  }

  formatCost(cost: Cost): string {
    const parts = [
      ...cost.amounts.map(amount => this.formatAmount(amount)),
      this.formatDate(cost.date),
      ...cost.tags.map(tag => `"${tag}"`),
    ];
    return `{ ${parts.join(', ')} }`;
  }

  formatPosition(position: Position): string {
    const parts = [this.formatAmount(position.amount)];
    if (position.cost !== null) {
      parts.push(this.formatCost(position.cost));
    }
    return parts.join(' ');
  }

  formatTransaction(
    transaction: Transaction,
    options?: FormatTransactionOptions,
  ): string {
    const parts = [this.formatTransactionHeader(transaction)];

    let inventories = transaction.inventoriesBefore;
    for (const posting of transaction.postings) {
      parts.push(this.formatPosting(transaction, posting));

      if (
        (options?.formatBalance ?? FormatBalanceMode.None) !==
        FormatBalanceMode.None
      ) {
        const newInventory = inventories
          .get(posting.account, Inventory.Empty)
          .addPosition(new Position(posting.amount, posting.cost));
        inventories = inventories.set(posting.account, newInventory);

        const positions = newInventory.getPositionsForCurrency(
          posting.amount.currency,
        );
        if (
          options?.formatBalance === FormatBalanceMode.Aggregate ||
          positions.length === 0
        ) {
          const total = positions.reduce(
            (acc, pos) => acc.add(pos.amount),
            new Amount(ZERO, posting.amount.currency),
          );

          parts.push(`  ; ${this.formatAmount(total)}`);
        } else {
          for (const position of positions) {
            parts.push(`  ; ${this.formatPosition(position)}`);
          }
        }
      }
    }

    return parts.join('\n');
  }

  formatInventories(
    inventories: InventoryMap,
    options?: FormatInventoriesOptions,
  ) {
    const maybeAggregatePositions =
      (options?.showCost ?? true)
        ? identity
        : (inventory: Inventory) =>
            Inventory.Empty.addAmounts(
              inventory.getPositions().map(x => x.amount),
            );

    if (options?.tree) {
      const showTotals = options.showTotals ?? false;
      const maxDepth = options.maxDepth ?? Number.MAX_SAFE_INTEGER;

      const root = makeAccountTree(
        new Map(Seq(inventories.entries()).sortBy(fst)),
        identity,
        (nodeInventory, inventories, depth) =>
          maybeAggregatePositions(
            showTotals || depth >= maxDepth
              ? inventories.reduce(
                  (acc, inventory) =>
                    acc.addPositions(inventory.getPositions()),
                  nodeInventory ?? Inventory.Empty,
                )
              : (nodeInventory ?? Inventory.Empty),
          ),
        (node, depth) =>
          depth <= maxDepth &&
          (!node.data.isEmpty() || node.children.length > 0),
      );
      return formatTree(root, node =>
        Seq(node.data.getPositions())
          .sortBy(x => x.amount.currency)
          .map(position => this.formatPosition(position))
          .toArray(),
      );
    }

    const lines: string[] = [];
    for (const [account, inventory] of inventories.entrySeq().sortBy(fst)) {
      const positions = Seq(
        maybeAggregatePositions(inventory).getPositions(),
      ).sortBy(a => Seq([a.amount.currency, a.cost?.date.getTime() ?? 0]));
      for (const position of positions) {
        lines.push(`${account} ${this.formatPosition(position)}`);
      }
    }
    return lines.join('\n');
  }

  private formatTransactionHeader(transaction: Transaction) {
    return `${this.formatDate(transaction.date)} ${transaction.flag} "${transaction.description}"`;
  }

  private formatPosting(transaction: Transaction, posting: BookedPosting) {
    const flag = posting.flag !== transaction.flag ? `${posting.flag} ` : '';
    return posting.cost === null
      ? `  ${flag}${posting.account} ${this.formatAmount(posting.amount)}`
      : `  ${flag}${posting.account} ${this.formatAmount(posting.amount)} ${this.formatCost(posting.cost)}`;
  }
}
