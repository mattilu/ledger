import assert from 'node:assert';

import { ExactNumber, ExactNumberType } from 'exactnumber';
import { function as F, option as O, readonlyArray as A } from 'fp-ts';
import { List, Map, Record, RecordOf, Seq, Set } from 'immutable';

import { partitionPoint } from './bounds.js';

export interface PriceEntry {
  readonly date: Date;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  readonly price: ExactNumberType;
}

type CurrencyPairProps = {
  /** Base currency, to get the price for. */
  readonly base: string;
  /** Quote currency, to get the price in. */
  readonly quote: string;
};

export type CurrencyPair = RecordOf<CurrencyPairProps>;
export const CurrencyPair = Record<CurrencyPairProps>(
  { base: '', quote: '' },
  'CurrencyPair',
);

export interface GetPriceOptions {
  /** Date to get the price at. If unspecified, returns the latest price. */
  readonly date?: Date;

  /**
   * If set to a positive number `N`, search for prices in the time window
   * `[date - N, date + N]`.
   *
   * If set to a pair of positive numbers `[before, after]`, search for prices
   * in the time window `[date - before, date + after]`.
   *
   * Only effective when `date` is specified.
   */
  readonly timeWindowSeconds?: number | [number, number];

  /**
   * If set to true, interpolate between the two closest data points in the time
   * window.
   *
   * Only effective if `date` and `timeWindowSeconds` are specified.
   */
  readonly interpolate?: boolean;

  /**
   * If set to true, allow computing the price indirectly, by doing a graph
   * search across prices for all currency pairs.
   */
  readonly indirect?: boolean;
}

export interface GetPriceResult {
  readonly price: ExactNumberType;
  readonly date: Date;
  readonly path: ReadonlyArray<
    | { readonly exact: PriceEntry }
    | {
        readonly before?: PriceEntry;
        readonly after?: PriceEntry;
      }
  >;
}

export interface GetPricesResult {
  readonly prices: Map<CurrencyPair, GetPriceResult>;
}

export class PriceDatabase {
  public static readonly Empty = new PriceDatabase(Map());

  private constructor(
    // Map from (baseCurrency, quoteCurrency) to price history.
    private readonly priceMap: Map<CurrencyPair, List<PriceEntry>>,
  ) {}

  /**
   * Adds prices to the DB.
   *
   * @param prices: Prices to add to the DB.
   * @returns A new PriceDatabase with the updated prices.
   */
  addPrices(prices: readonly PriceEntry[]) {
    return new PriceDatabase(
      this.priceMap.withMutations(priceMap => {
        Seq(prices)
          .groupBy(price =>
            CurrencyPair({
              base: price.baseCurrency,
              quote: price.quoteCurrency,
            }),
          )
          .forEach((prices, key) => {
            priceMap.update(key, (currentPrices = List()) =>
              currentPrices.push(...prices).sortBy(x => x.date.getTime()),
            );
            priceMap.update(
              CurrencyPair({
                base: key.quote,
                quote: key.base,
              }),
              (currentPrices = List()) =>
                currentPrices.push(...prices).sortBy(x => x.date.getTime()),
            );
          });
      }),
    );
  }

  /**
   * Gets price entries for the currency pair.
   *
   * @param base Base currency to get price entries for.
   * @param quote Quote currency to get price entries for.
   * @returns The price entries for the currency pair.
   */
  getPriceEntries(base: string, quote: string): PriceEntry[] {
    return this.priceMap.get(CurrencyPair({ base, quote }))?.toArray() ?? [];
  }

  /** Gets the price for a single currency pair.
   *
   * @param base Base currency to get price.
   * @param quote Quote currency to get price in.
   * @param options Options for price computation.
   */
  getPrice(
    currencyPair: CurrencyPair,
    options?: GetPriceOptions,
  ): O.Option<GetPriceResult> {
    const { prices } = this.getPrices([currencyPair], options);
    return O.fromNullable(prices.get(currencyPair));
  }

  /**
   * Returns the prices for multiple currency pairs.
   *
   * @param bases Array of base currencies to get prices for.
   * @param quote Quote currency to get price in.
   * @param options Options for price computation.
   * @returns A `GetPricesResult` with the result.
   */
  getPrices(
    currencyPairs: readonly CurrencyPair[],
    options?: GetPriceOptions,
  ): GetPricesResult {
    return options?.indirect
      ? this.getPricesGraphSearch(currencyPairs, options)
      : this.getPricesDirect(currencyPairs, options);
  }

  private getPricesDirect(
    currencyPairs: readonly CurrencyPair[],
    options?: GetPriceOptions,
  ): GetPricesResult {
    return {
      prices: F.pipe(
        Set(currencyPairs).toArray(),
        A.filterMap(pair =>
          F.pipe(
            this.getPriceDirect(pair, options),
            O.map(x => [pair, x] as const),
          ),
        ),
        entries => Map(entries),
      ),
    };
  }

  private getPriceDirect(
    currencyPair: CurrencyPair,
    options?: GetPriceOptions,
  ): O.Option<GetPriceResult> {
    const entries = filterEntries(this.priceMap.get(currencyPair), options);

    if (entries.exact) {
      return F.pipe(
        evalPrice(currencyPair, entries.exact),
        O.map(price => ({
          price,
          date: entries.exact!.date,
          path: [entries],
        })),
      );
    }

    if (!entries.before && !entries.after) {
      return O.none;
    }

    let entry: PriceEntry;
    if (entries.before && entries.after) {
      // If `options.date` is not specified, `filterEntries` returns the last
      // price as `exact`, so there's no way we have `entries.before` or
      // `entries.after` and not `options.date`.
      assert(options?.date);
      entry =
        options.date.getTime() - entries.before.date.getTime() <=
        entries.after.date.getTime() - options.date.getTime()
          ? entries.before
          : entries.after;

      if (options.interpolate) {
        const dx = ExactNumber(
          Math.round(
            entries.after.date.getTime() - entries.before.date.getTime(),
          ),
        );
        // Should never happen, as we would have an exact entry instead
        assert(!dx.isZero());

        const dx1 = ExactNumber(
          Math.round(options.date.getTime() - entries.before.date.getTime()),
        );

        return F.pipe(
          O.Do,
          O.bind('priceBefore', () => evalPrice(currencyPair, entries.before!)),
          O.bind('priceAfter', () => evalPrice(currencyPair, entries.after!)),
          O.let('dy', ({ priceAfter, priceBefore }) =>
            priceAfter.sub(priceBefore),
          ),
          O.map(({ priceBefore, dy }) => priceBefore.add(dy.div(dx).mul(dx1))),
          O.map(price => ({
            date: options.date!,
            price: price.normalize(),
            path: [entries],
          })),
        );
      }
    } else {
      entry = (entries.before ?? entries.after)!;
    }

    return F.pipe(
      evalPrice(currencyPair, entry),
      O.map(price => ({
        date: entry.date,
        price,
        path: [entries],
      })),
    );
  }

  private getPricesGraphSearch(
    currencyPairs: readonly CurrencyPair[],
    options?: GetPriceOptions,
  ): GetPricesResult {
    void currencyPairs;
    void options;
    return {
      prices: Map(),
    };
  }
}

function evalPrice(
  currencyPair: CurrencyPairProps,
  entry: PriceEntry,
): O.Option<ExactNumberType> {
  if (
    currencyPair.base === entry.baseCurrency &&
    currencyPair.quote === entry.quoteCurrency
  ) {
    return O.of(entry.price);
  } else if (
    currencyPair.base === entry.quoteCurrency &&
    currencyPair.quote === entry.baseCurrency
  ) {
    if (!entry.price.isZero()) {
      return O.of(entry.price.inv().normalize());
    } else {
      return O.none;
    }
  } else {
    assert(
      false,
      `unexpected evaluation with mismatched currencies for ${currencyPair}`,
    );
  }
}

function filterEntries(
  entries: List<PriceEntry> | undefined,
  options?: GetPriceOptions,
): {
  readonly exact?: PriceEntry;
  readonly before?: PriceEntry;
  readonly after?: PriceEntry;
} {
  if (!entries || entries.size === 0) {
    return {};
  }

  if (!options?.date) {
    return { exact: entries.last()! };
  }

  const time = options.date.getTime();
  let timeLow: number, timeHigh: number;

  if (options.timeWindowSeconds) {
    if (typeof options.timeWindowSeconds === 'number') {
      timeLow = time - options.timeWindowSeconds * 1000;
      timeHigh = time + options.timeWindowSeconds * 1000;
    } else {
      timeLow = time - options.timeWindowSeconds[0] * 1000;
      timeHigh = time + options.timeWindowSeconds[1] * 1000;
    }
  } else {
    timeLow = timeHigh = time;
  }

  const entriesArr = entries.toArray();

  // The index of the first entry with date > options.date
  const hi = partitionPoint(entriesArr, entry => entry.date.getTime() <= time);
  // The index of the last entry with date <= options.date
  const lo = hi - 1;

  if (lo >= 0 && entriesArr[lo].date.getTime() === time) {
    return { exact: entriesArr[lo] };
  }

  const before =
    lo >= 0 && entriesArr[lo].date.getTime() >= timeLow
      ? entriesArr[lo]
      : undefined;
  const after =
    hi < entriesArr.length && entriesArr[hi].date.getTime() <= timeHigh
      ? entriesArr[hi]
      : undefined;

  return { before, after };
}
