import assert from 'node:assert';

import { ExactNumber, ExactNumberType } from 'exactnumber';
import { function as F, option as O, readonlyArray as A } from 'fp-ts';
import { List, Map, Record, RecordOf, Seq, Set } from 'immutable';

import { partitionPoint } from './bounds.js';
import { Graph } from './internal/graph.js';

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
   *
   * Ignored when `indirect` is true.
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
    // High level algorithm:
    //
    // We build a graph, where nodes are (currency, timestamp) pairs, and edges
    // are conversion rates. We have two types of edges:
    //  - `price` edges, which connect different currencies at the stame
    //    timestamp. The conversion rate is the value from the price entry.
    //  - `time-shift` edges, which connect the same currency at different
    //     timestamps. The conversion rate is implicitly 1.
    //
    // We also add "entry" and "exit" nodes for the date requested by the user,
    // with edges to each of the nodes in the graph:
    //  - A (base, T_req) -> (base, T_x) "entry" edge
    //  - A (quote, T_x) -> (quote, T_req) "exit" edge
    //
    // We then use `optimalPaths` to find the optimal path from (base, T_req)
    // to (quote, T_req). The conversion rate is the product of the rates along
    // the path.
    //
    // Now some implementation details:
    //
    // - For the PathAlgebra, our date is a (timeCost, conversionCost) pair.
    // - Each `price` edge contributes a `timeCost` proportional to the delta
    //   between t_req and the timestamp of the price entry.
    // - Each `time-shift` edge contributes 1 (a "hop") to the conversionCost.
    // - The `combine` operation of the PathAlgebra keeps the max timeCost (as
    //   the staleness of the data depends on the most stale data point), and
    //   sums the conversionCost (as we want to minimize the number of hops).
    //
    // Overall, this finds the path that uses the least stale data, and also
    // minimizes the number of hops between currencies.
    //
    // As an optimization, instead of running N independent searches (one for
    // each currency pair), we group the pairs by quote currency (as the most
    // common use case will be to convert all currencies to the same quote
    // currency.)

    type Node = {
      readonly currency: string;
      readonly timestamp: number;
    };
    type Edge =
      | { type: 'price'; priceEntry: PriceEntry }
      | { type: 'time-shift' };

    const reqTimestamp = (options?.date ?? new Date()).getTime();

    const graph = new Graph<Node, Edge, string>(
      x => `${x.currency}|${x.timestamp}`,
    );

    // Graph construction.
    for (const [currencyPair, priceEntries] of this.priceMap.entries()) {
      const filteredEntries = filterEntriesForGraphSearch(
        priceEntries,
        options,
      );

      for (const priceEntry of filteredEntries) {
        const baseNode: Node = {
          currency: currencyPair.base,
          timestamp: priceEntry.date.getTime(),
        };
        const quoteNode: Node = {
          currency: currencyPair.quote,
          timestamp: priceEntry.date.getTime(),
        };
        // Price edge from base to quote. We don't add the inverse edge as the
        // priceMap already contains entries in both directions.
        graph.setEdge(baseNode, quoteNode, { type: 'price', priceEntry });

        // "entry" edge from the base currency at t_req.
        graph.setEdge(
          { currency: baseNode.currency, timestamp: reqTimestamp },
          baseNode,
          { type: 'time-shift' },
        );
        // "exit" edge to the quote currency at t_req.
        graph.setEdge(
          quoteNode,
          { currency: quoteNode.currency, timestamp: reqTimestamp },
          { type: 'time-shift' },
        );
      }

      // Add the `time-shift` entries. We connect each entry to the next one, we
      // don't need to make the graph more dense since we want to explore
      // linearly through time anyway.
      for (const [a, b] of filteredEntries.zip(filteredEntries.skip(1)) as List<
        [PriceEntry, PriceEntry]
      >) {
        // Note: we don't add the edges for quote currency here as priceMap
        // contains entries in the opposite direction that cover them.
        const baseA: Node = {
          currency: currencyPair.base,
          timestamp: a.date.getTime(),
        };
        const baseB: Node = {
          currency: currencyPair.base,
          timestamp: b.date.getTime(),
        };
        graph.setEdge(baseA, baseB, { type: 'time-shift' });
        graph.setEdge(baseB, baseA, { type: 'time-shift' });
      }
    }

    // Most common use case is to convert all currencies to the same quote
    // currency, so we group the pairs by quote currency, and run Dijkstra on
    // each (quote, [bases]) pair, which usually results in a single run.
    const groupedPairs = Seq(currencyPairs)
      .groupBy(x => x.quote)
      .map(quotes => quotes.map(x => x.base).toArray());

    // Run the graph searches.
    const paths = groupedPairs.entrySeq().flatMap(([quote, bases]) => {
      const sourceNode: Node = {
        currency: quote,
        timestamp: reqTimestamp,
      };
      const targetNodes: Node[] = bases.map(base => ({
        currency: base,
        timestamp: reqTimestamp,
      }));
      const paths = graph.optimalPaths(
        sourceNode,
        targetNodes,
        (edge, _, to) =>
          edge.type === 'price'
            ? {
                timeCost: 0,
                conversionCost: 1,
              }
            : {
                timeCost: Math.abs(to.timestamp - reqTimestamp),
                conversionCost: 0,
              },
        {
          e: { conversionCost: 0, timeCost: 0 },
          betterThan: (a, b) =>
            a.timeCost === b.timeCost
              ? a.conversionCost < b.conversionCost
              : a.timeCost < b.timeCost,
          combine: (a, b) => ({
            conversionCost: a.conversionCost + b.conversionCost,
            timeCost: Math.max(a.timeCost, b.timeCost),
          }),
        },
      );

      return paths;
    });

    const prices = Map(
      paths
        .map((path): O.Option<[CurrencyPair, GetPriceResult]> => {
          if (path.path === null) {
            return O.none;
          }

          const priceEdges = path.path
            .map(x => x.edge)
            .filter(x => x.type === 'price');

          return F.pipe(
            path.path,
            O.traverseArray(n =>
              n.edge.type === 'price'
                ? evalPrice(
                    // Evaluate in the opposite direction as the edge as our
                    // graph search is from quote to base.
                    { base: n.to.currency, quote: n.from.currency },
                    n.edge.priceEntry,
                  )
                : O.some(ONE),
            ),
            O.map(prices => prices.reduce((acc, x) => acc.mul(x), ONE)),
            O.map(price => [
              CurrencyPair({
                base: path.target.currency,
                quote: path.source.currency,
              }),
              {
                date: new Date(
                  Math.max(...priceEdges.map(x => x.priceEntry.date.getTime())),
                ),
                price: price,
                path: priceEdges
                  .map(x => ({ exact: x.priceEntry }))
                  .toReversed(),
              },
            ]),
          );
        })
        .filter(x => O.isSome(x))
        .map(x => x.value),
    );

    return { prices };
  }
}

const ONE = ExactNumber(1);

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

function filterEntriesForGraphSearch(
  entries: List<PriceEntry>,
  options?: GetPriceOptions,
): List<PriceEntry> {
  // If date is not specified, allow using all entries.
  if (!options?.date) {
    return entries;
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

  // The index of the first entry with date >= dateLo
  const lo = partitionPoint(
    entriesArr,
    entry => entry.date.getTime() < timeLow,
  );
  // The index of the first entry with date > dateHi
  const hi = partitionPoint(
    entriesArr,
    entry => entry.date.getTime() <= timeHigh,
    lo,
  );

  return List(entriesArr.slice(lo, hi));
}
