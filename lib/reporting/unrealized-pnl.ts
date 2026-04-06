import { strict as assert } from 'node:assert';

import { Map, Seq } from 'immutable';

import { Inventory } from '../booking/inventory.js';
import { BookedLedger } from '../booking/ledger.js';
import { Position } from '../booking/position.js';
import { Amount } from '../core/amount.js';
import { Formatter } from '../utils/formatting.js';
import {
  CurrencyPair,
  GetPriceResult,
  PriceDatabase,
} from '../utils/price-db.js';
import { makeRegexp } from './internal/regexp-utils.js';
import { Report } from './report.js';

export interface UnrealizedPnlReportOptions {
  /**
   * If specified, limits reporting to these accounts. Can use regexes.
   */
  readonly accounts?: readonly string[];

  /**
   * If specified, excludes these accounts from reporting. Can use regexes.
   */
  readonly excludeAccounts?: readonly string[];

  /**
   * If specified, limits reporting to these currencies. Can use regexes.
   */
  readonly currencies?: readonly string[];

  /**
   * Options for formatting of the inventory.
   */
  readonly formatOptions?: {
    /** If true, show the aggregate PnL rather than per-position PnL. */
    readonly aggregate?: boolean;

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
}

interface PnlEntry {
  readonly position: Amount;
  readonly currentPrice: Amount;
  readonly currentValue: Amount;
  readonly totalCost: Amount;
  readonly totalPnl: Amount;
  readonly perUnitCost: Amount;
  readonly perUnitPnl: Amount;
}

/**
 * Reports final state of the inventories for each account.
 */
export class UnrealizedPnlReport implements Report {
  private readonly accountRegex: RegExp | null;
  private readonly excludeAccountRegex: RegExp | null;
  private readonly currenciesRegex: RegExp | null;
  private readonly formatOptions;

  constructor(options: UnrealizedPnlReportOptions) {
    this.accountRegex = makeRegexp(options.accounts ?? []);
    this.excludeAccountRegex = makeRegexp(options.excludeAccounts ?? []);
    this.currenciesRegex = makeRegexp(options.currencies ?? []);
    this.formatOptions = options.formatOptions;
  }

  run(ledger: BookedLedger): string {
    let inventories = ledger.inventories
      .entrySeq()
      .map(
        ([account, inventory]) =>
          [account, filterInventory(inventory, x => x.cost !== null)] as const,
      );
    if (this.excludeAccountRegex) {
      inventories = inventories.filterNot(([account]) =>
        this.excludeAccountRegex!.test(account),
      );
    }
    if (this.accountRegex) {
      inventories = inventories.filter(([account]) =>
        this.accountRegex!.test(account),
      );
    }
    if (this.currenciesRegex) {
      inventories = inventories.map(
        ([account, inventory]) =>
          [
            account,
            filterInventory(inventory, position =>
              currencyMatches(position, this.currenciesRegex!),
            ),
          ] as const,
      );
    }

    const currencyPairs = inventories
      .flatMap(([, inventory]) =>
        inventory.getPositions().flatMap(p =>
          p.cost!.amounts.map(cost =>
            CurrencyPair({
              base: p.amount.currency,
              quote: cost.currency,
            }),
          ),
        ),
      )
      .toSet();

    const priceDb = PriceDatabase.Empty.addPrices(
      ledger.prices.map(d => ({
        baseCurrency: d.currency,
        quoteCurrency: d.price.currency,
        date: d.date,
        price: d.price.amount,
      })),
    );

    const { prices } = priceDb.getPrices(currencyPairs.toArray(), {
      indirect: true,
    });

    const pnl = inventories.map(
      ([account, inventory]) => [account, makePnl(inventory, prices)] as const,
    );

    const formatter = new Formatter({ currencyMap: ledger.currencyMap });
    const formatWithSign = (amount: Amount) => {
      const formatted = formatter.formatAmount(amount);
      return amount.isPos() ? `+${formatted}` : formatted;
    };

    return formatter.formatAccounts(
      Map(pnl),
      entries =>
        Seq(this.formatOptions?.aggregate ? aggregatePnl(entries) : entries)
          .sortBy(x => Seq([x.position.currency, x.position.amount.toNumber()]))
          .map(
            entry =>
              `${formatWithSign(entry.totalPnl)}` +
              ` / ${formatWithSign(entry.perUnitPnl)}/${entry.position.currency}` +
              ` ; Position: ${formatter.formatAmount(entry.position)}` +
              ` {{ ${formatter.formatAmount(entry.totalCost)} }}` +
              ` { ${formatter.formatAmount(entry.perUnitCost)} }` +
              ` Price: ${formatter.formatAmount(entry.currentPrice)}` +
              ` Value: ${formatter.formatAmount(entry.currentValue)}`,
          )
          .toArray(),
      {
        tree: this.formatOptions?.tree,
        aggregate: this.formatOptions?.showTotals,
        reduce: (entries): PnlEntry[] => entries.flat(),
        filter: entries => entries.length > 0,
        maxDepth: this.formatOptions?.maxDepth,
      },
    );
  }
}

function currencyMatches(position: Position, regex: RegExp): boolean {
  return (
    regex.test(position.amount.currency) ||
    !!position.cost?.amounts.some(x => regex.test(x.currency))
  );
}

function filterInventory(
  inventory: Inventory,
  pred: (position: Position) => boolean,
) {
  return Inventory.Empty.addPositions(inventory.getPositions().filter(pred));
}

function makePnl(
  inventory: Inventory,
  prices: Map<CurrencyPair, GetPriceResult>,
): PnlEntry[] {
  return inventory
    .getPositions()
    .flatMap(position => makePnlEntries(position, prices));
}

function makePnlEntries(
  position: Position,
  prices: Map<CurrencyPair, GetPriceResult>,
): PnlEntry[] {
  return position.cost!.amounts.map((costPrice): PnlEntry => {
    const priceResult = prices.get(
      CurrencyPair({
        base: position.amount.currency,
        quote: costPrice.currency,
      }),
    );

    // If price is not found, assume it's unchanged from the initial cost.
    const price = priceResult
      ? new Amount(priceResult.price, costPrice.currency)
      : costPrice;
    const perUnitPnl = price.sub(costPrice);

    return {
      position: position.amount,
      currentPrice: price,
      currentValue: price.mul(position.amount.amount),
      perUnitPnl,
      totalPnl: perUnitPnl.mul(position.amount.amount),
      perUnitCost: costPrice,
      totalCost: costPrice.mul(position.amount.amount),
    };
  });
}

function aggregatePnl(entries: PnlEntry[]): PnlEntry[] {
  const ret = Map<CurrencyPair, PnlEntry[]>()
    .withMutations(pnlMap => {
      for (const entry of entries) {
        const key = CurrencyPair({
          base: entry.position.currency,
          quote: entry.perUnitPnl.currency,
        });
        pnlMap = pnlMap.update(key, acc => {
          if (acc === undefined) return [entry];
          acc.push(entry);
          return acc;
        });
      }
    })
    .map(entries => mergeEntries(entries))
    .valueSeq()
    .toArray();
  return ret;
}

function mergeEntries(a: PnlEntry[]): PnlEntry {
  assert(a.length > 0);
  const reduced = a.reduce((acc, entry) => ({
    ...acc,
    position: acc.position.add(entry.position),
    totalPnl: acc.totalPnl.add(entry.totalPnl),
    totalCost: acc.totalCost.add(entry.totalCost),
  }));

  return {
    position: reduced.position,
    currentPrice: reduced.currentPrice,
    currentValue: reduced.currentPrice.mul(reduced.position.amount),
    totalPnl: reduced.totalPnl,
    perUnitPnl: reduced.totalPnl.div(reduced.position.amount),
    totalCost: reduced.totalCost,
    perUnitCost: reduced.totalCost.div(reduced.position.amount),
  };
}
