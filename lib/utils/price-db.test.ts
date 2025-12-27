import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExactNumber } from 'exactnumber';
import { function as F, option as O } from 'fp-ts';
import { Map } from 'immutable';

import { Amount } from '../core/amount.js';
import {
  CurrencyPair,
  GetPriceOptions,
  GetPriceResult,
  GetPricesResult,
  PriceDatabase,
  PriceEntry,
} from './price-db.js';

const N = (n: number | string) => ExactNumber(n).normalize();
const amount = (n: number | string, currency: string) =>
  new Amount(N(n), currency);

const currencyPair = (base: string, quote: string) =>
  CurrencyPair({ base, quote });

const entry = (date: string, currency: string, price: Amount): PriceEntry => ({
  date: new Date(date),
  baseCurrency: currency,
  quoteCurrency: price.currency,
  price: price.amount,
});

await describe('PriceDatabase', () => {
  describe('#getPriceEntries', () => {
    it('returns empty array for empty database', () => {
      assert.deepEqual(PriceDatabase.Empty.getPriceEntries('EUR', 'CHF'), []);
    });

    it('returns an array of entries in the database for the given pair', () => {
      const db = PriceDatabase.Empty.addPrices([
        entry('2025-12-01', 'USD', amount('0.8033', 'CHF')),
        entry('2025-12-01', 'EUR', amount('0.9319', 'CHF')),
        entry('2025-12-02', 'USD', amount('0.8046', 'CHF')),
        entry('2025-12-02', 'EUR', amount('0.9340', 'CHF')),
      ]);

      assert.deepEqual(db.getPriceEntries('USD', 'CHF'), [
        entry('2025-12-01', 'USD', amount('0.8033', 'CHF')),
        entry('2025-12-02', 'USD', amount('0.8046', 'CHF')),
      ]);
      assert.deepEqual(db.getPriceEntries('EUR', 'CHF'), [
        entry('2025-12-01', 'EUR', amount('0.9319', 'CHF')),
        entry('2025-12-02', 'EUR', amount('0.9340', 'CHF')),
      ]);
    });
  });

  describe('#addPrices', () => {
    it('keeps prices in sorted order', () => {
      const db = PriceDatabase.Empty.addPrices([
        entry('2025-12-02', 'USD', amount('0.8046', 'CHF')),
        entry('2025-12-01', 'USD', amount('0.8033', 'CHF')),
      ]);

      assert.deepEqual(db.getPriceEntries('USD', 'CHF'), [
        entry('2025-12-01', 'USD', amount('0.8033', 'CHF')),
        entry('2025-12-02', 'USD', amount('0.8046', 'CHF')),
      ]);
    });

    it('adds prices for the inverted pair', () => {
      const db = PriceDatabase.Empty.addPrices([
        entry('2025-12-01', 'USD', amount('0.8033', 'CHF')),
      ]);

      assert.deepEqual(db.getPriceEntries('CHF', 'USD'), [
        entry('2025-12-01', 'CHF', amount('1 / 0.8033', 'USD')),
      ]);
    });

    it('adds direct price but not inverted price if price is 0', () => {
      const db = PriceDatabase.Empty.addPrices([
        entry('2025-12-01', 'FOO', amount(0, 'CHF')),
      ]);

      assert.deepEqual(db.getPriceEntries('FOO', 'CHF'), [
        entry('2025-12-01', 'FOO', amount(0, 'CHF')),
      ]);

      assert.deepEqual(db.getPriceEntries('CHF', 'FOO'), []);
    });
  });

  const db = PriceDatabase.Empty.addPrices([
    entry('2025-12-01', 'A', amount('10', 'B')),
    entry('2025-12-02', 'A', amount('11', 'B')),
    entry('2025-12-03', 'A', amount('10', 'B')),
    entry('2025-12-06', 'A', amount('12', 'B')),
    entry('2025-12-07', 'A', amount('13', 'B')),
    entry('2025-12-08', 'A', amount('12', 'B')),
    //
    entry('2025-12-01', 'B', amount('100', 'C')),
    entry('2025-12-02', 'B', amount('102', 'C')),
    entry('2025-12-07', 'B', amount('104', 'C')),
    entry('2025-12-08', 'B', amount('105', 'C')),
  ]);

  const priceTests: Array<{
    name: string;
    currencyPair: CurrencyPair;
    options: GetPriceOptions;
    want: O.Option<GetPriceResult>;
  }> = [
    {
      name: 'finds the last price',
      currencyPair: currencyPair('A', 'B'),
      options: {},
      want: O.some({
        price: N('12'),
        date: new Date('2025-12-08'),
        path: [
          {
            exact: entry('2025-12-08', 'A', amount('12', 'B')),
          },
        ],
      }),
    },
    {
      name: 'finds the price at the given date',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-03'),
      },
      want: O.some({
        price: N('10'),
        date: new Date('2025-12-03'),
        path: [
          {
            exact: entry('2025-12-03', 'A', amount('10', 'B')),
          },
        ],
      }),
    },
    {
      name: 'price not found at the at the given date',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-04'),
      },
      want: O.none,
    },
    {
      name: 'finds the closest price within the time window',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-04'),
        timeWindowSeconds: 60 * 60 * 24 * 2, // 2d
      },
      want: O.some({
        price: N('10'),
        date: new Date('2025-12-03'),
        path: [
          {
            before: entry('2025-12-03', 'A', amount('10', 'B')),
            after: entry('2025-12-06', 'A', amount('12', 'B')),
          },
        ],
      }),
    },
    {
      name: 'price not found within the time window',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-04T12:00Z'),
        timeWindowSeconds: 60 * 60 * 24, // 1d
      },
      want: O.none,
    },
    {
      name: 'finds the closest price within the time window (before first)',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-11-30'),
        timeWindowSeconds: 60 * 60 * 24, // 1d
      },
      want: O.some({
        price: N('10'),
        date: new Date('2025-12-01'),
        path: [
          {
            before: undefined,
            after: entry('2025-12-01', 'A', amount('10', 'B')),
          },
        ],
      }),
    },
    {
      name: 'finds the closest price within the time window (after last)',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-09'),
        timeWindowSeconds: 60 * 60 * 24, // 1d
      },
      want: O.some({
        price: N('12'),
        date: new Date('2025-12-08'),
        path: [
          {
            before: entry('2025-12-08', 'A', amount('12', 'B')),
            after: undefined,
          },
        ],
      }),
    },
    {
      name: 'finds the closest price within the asymmetric time window',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-04'),
        timeWindowSeconds: [0, 60 * 60 * 24 * 2], // [0, 2d]
      },
      want: O.some({
        price: N('12'),
        date: new Date('2025-12-06'),
        path: [
          {
            before: undefined,
            after: entry('2025-12-06', 'A', amount('12', 'B')),
          },
        ],
      }),
    },
    {
      name: 'interpolates the closest prices within the time window',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-04'),
        timeWindowSeconds: 60 * 60 * 24 * 2, // 2d
        interpolate: true,
      },
      want: O.some({
        price: N('10.(6)'),
        date: new Date('2025-12-04'),
        path: [
          {
            before: entry('2025-12-03', 'A', amount('10', 'B')),
            after: entry('2025-12-06', 'A', amount('12', 'B')),
          },
        ],
      }),
    },
    {
      name: 'finds the inverse price',
      currencyPair: currencyPair('B', 'A'),
      options: {
        date: new Date('2025-12-01'),
      },
      want: O.some({
        price: N('1/10'),
        date: new Date('2025-12-01'),
        path: [
          {
            exact: entry('2025-12-01', 'B', amount('1/10', 'A')),
          },
        ],
      }),
    },
    {
      name: 'price not found for the direct currency pair',
      currencyPair: currencyPair('A', 'C'),
      options: {
        date: new Date('2025-12-01'),
      },
      want: O.none,
    },
    {
      name: 'indirect algorithm not implemeted yet',
      currencyPair: currencyPair('A', 'B'),
      options: {
        date: new Date('2025-12-01'),
        indirect: true,
      },
      want: O.none,
    },
  ];

  describe('#getPrice', () => {
    for (const test of priceTests) {
      it(test.name, () => {
        const got = db.getPrice(test.currencyPair, test.options);

        assert.deepEqual(got, test.want);
      });
    }
  });

  describe('#getPrices', () => {
    for (const test of priceTests) {
      it(test.name, () => {
        const got = db.getPrices([test.currencyPair], test.options);
        const want = F.pipe(
          test.want,
          O.map(x => Map([[test.currencyPair, x]] as const)),
          O.getOrElse(() => Map()),
        );

        assert.deepEqual(got.prices, want);
      });
    }

    const tests: Array<{
      name: string;
      currencyPairs: CurrencyPair[];
      options?: GetPriceOptions;
      want: GetPricesResult;
    }> = [
      {
        name: 'empty currency pairs',
        currencyPairs: [],
        want: { prices: Map() },
      },
      {
        name: 'multiple pairs with same base',
        currencyPairs: [currencyPair('A', 'C'), currencyPair('B', 'C')],
        want: {
          prices: Map([
            [
              currencyPair('B', 'C'),
              {
                price: N('105'),
                date: new Date('2025-12-08'),
                path: [{ exact: entry('2025-12-08', 'B', amount('105', 'C')) }],
              },
            ],
          ]),
        },
      },
      {
        name: 'multiple pairs with same quote',
        currencyPairs: [currencyPair('A', 'B'), currencyPair('A', 'C')],
        want: {
          prices: Map([
            [
              currencyPair('A', 'B'),
              {
                price: N('12'),
                date: new Date('2025-12-08'),
                path: [{ exact: entry('2025-12-08', 'A', amount('12', 'B')) }],
              },
            ],
          ]),
        },
      },
    ];

    for (const test of tests) {
      it(test.name, () => {
        const got = db.getPrices(test.currencyPairs, test.options);
        assert.deepEqual(got, test.want);
      });
    }
  });
});
