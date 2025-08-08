import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExactNumber } from 'exactnumber';
import { Map } from 'immutable';

import { Cost } from '../booking/cost.js';
import { Position } from '../booking/position.js';
import { Transaction } from '../booking/transaction.js';
import { Amount } from '../core/amount.js';
import { CurrencyDirective } from '../loading/directives/currency.js';
import { Formatter } from './formatting.js';

const amount = (amount: number | string, currency: string) =>
  new Amount(ExactNumber(amount), currency);

const cost = (amounts: Amount[], date: string, tags: string[] = []) =>
  new Cost(
    amounts,
    new Date(date),
    { date: '', time: null, timezone: null },
    tags,
  );

await describe('Formatter', async () => {
  const formatter = new Formatter({
    currencyMap: Map([
      [
        'CHF',
        {
          meta: Map([
            ['format-decimals', { type: 'number', value: ExactNumber(2) }],
          ]),
        } as CurrencyDirective,
      ],
      [
        'JPY',
        {
          meta: Map([
            ['format-decimals', { type: 'number', value: ExactNumber(0) }],
          ]),
        } as CurrencyDirective,
      ],
    ]),
  });

  await describe('#formatDate', async () => {
    const tests: Array<{ name: string; date: string; want: string }> = [
      { name: 'date', date: '2025-06-01T00:00:00Z', want: '2025-06-01' },
      {
        name: 'datetime without seconds',
        date: '2025-06-01T01:00:00Z',
        want: '2025-06-01 01:00Z',
      },
      {
        name: 'datetime with seconds',
        date: '2025-06-01T01:01:01Z',
        want: '2025-06-01 01:01:01Z',
      },
    ];

    for (const t of tests) {
      await it(`formats the date [${t.name}]`, () => {
        const got = formatter.formatDate(new Date(t.date));
        assert.equal(got, t.want);
      });
    }
  });

  await describe('#formatAmount', async () => {
    const tests: Array<{ name: string; amount: Amount; want: string }> = [
      {
        name: 'two decimals - 1',
        amount: amount(1, 'CHF'),
        want: '1.00 CHF',
      },
      {
        name: 'two decimals - 1/3',
        amount: amount('1/3', 'CHF'),
        want: '0.33 CHF',
      },
      {
        name: 'two decimals - 2/3',
        amount: amount('2/3', 'CHF'),
        want: '0.67 CHF',
      },
      {
        name: 'zero decimals - 1',
        amount: amount(1, 'JPY'),
        want: '1 JPY',
      },
      {
        name: 'zero decimals - 1/3',
        amount: amount('1/3', 'JPY'),
        want: '0 JPY',
      },
      {
        name: 'zero decimals - 2/3',
        amount: amount('2/3', 'JPY'),
        want: '1 JPY',
      },
      {
        name: 'no format-decimals - 1',
        amount: amount(1, 'FOO'),
        want: '1 FOO',
      },
      {
        name: 'no format-decimals - 1/3',
        amount: amount('1/3', 'FOO'),
        want: '0.(3) FOO',
      },
      {
        name: 'no format-decimals - 2/3',
        amount: amount('2/3', 'FOO'),
        want: '0.(6) FOO',
      },
    ];

    for (const t of tests) {
      await it(`formats the amount [${t.name}]`, () => {
        const got = formatter.formatAmount(t.amount);
        assert.equal(got, t.want);
      });
    }
  });

  await describe('#formatCost', async () => {
    const tests: Array<{ name: string; cost: Cost; want: string }> = [
      {
        name: 'two decimals, date',
        cost: cost([amount(1, 'CHF')], '2025-06-01'),
        want: '{ 1.00 CHF, 2025-06-01 }',
      },
      {
        name: 'two decimals, datetime',
        cost: cost([amount(1, 'CHF')], '2025-06-01T01:00Z'),
        want: '{ 1.00 CHF, 2025-06-01 01:00Z }',
      },
      {
        name: 'zero decimals, date',
        cost: cost([amount(1, 'JPY')], '2025-06-01'),
        want: '{ 1 JPY, 2025-06-01 }',
      },
      {
        name: 'zero decimals, datetime',
        cost: cost([amount(1, 'JPY')], '2025-06-01T01:00Z'),
        want: '{ 1 JPY, 2025-06-01 01:00Z }',
      },
      {
        name: 'multiple costs',
        cost: cost([amount(35, 'ETH'), amount(1, 'BTC')], '2025-06-01'),
        want: '{ 35 ETH, 1 BTC, 2025-06-01 }',
      },
      {
        name: 'tags',
        cost: cost([amount(1, 'CHF')], '2025-08-01', ['tag-1', 'tag-2']),
        want: '{ 1.00 CHF, 2025-08-01, "tag-1", "tag-2" }',
      },
    ];

    for (const t of tests) {
      await it(`formats the cost [${t.name}]`, () => {
        const got = formatter.formatCost(t.cost);
        assert.equal(got, t.want);
      });
    }
  });

  await describe('#formatPosition', async () => {
    const tests: Array<{ name: string; position: Position; want: string }> = [
      {
        name: 'without cost',
        position: new Position(amount(1, 'CHF'), null),
        want: '1.00 CHF',
      },
      {
        name: 'with cost',
        position: new Position(
          amount(1, 'VT'),
          cost([amount(125, 'CHF')], '2025-06-01'),
        ),
        want: '1 VT { 125.00 CHF, 2025-06-01 }',
      },
    ];

    for (const t of tests) {
      await it(`formats the position [${t.name}]`, () => {
        const got = formatter.formatPosition(t.position);
        assert.equal(got, t.want);
      });
    }
  });

  await describe('#formatTransaction', async () => {
    const tests: Array<{
      name: string;
      transaction: Partial<Transaction>;
      want: string;
    }> = [
      {
        name: 'without postings',
        transaction: {
          date: new Date('2025-06-01'),
          description: 'Test',
          flag: '*',
          postings: [],
        },
        want: '2025-06-01 * "Test"',
      },
      {
        name: 'posting costs',
        transaction: {
          date: new Date('2025-06-01'),
          description: 'Test',
          flag: '*',
          postings: [
            {
              account: 'Assets:Test',
              amount: amount(1, 'CHF'),
              cost: null,
              flag: '*',
              meta: Map(),
            },
            {
              account: 'Assets:Test',
              amount: amount(1, 'CHF'),
              cost: cost([amount(1, 'USD')], '2025-06-01'),
              flag: '*',
              meta: Map(),
            },
          ],
        },
        want: `\
2025-06-01 * "Test"
  Assets:Test 1.00 CHF
  Assets:Test 1.00 CHF { 1 USD, 2025-06-01 }`,
      },
      {
        name: 'postings flags',
        transaction: {
          date: new Date('2025-06-01'),
          description: 'Test',
          flag: '!',
          postings: [
            {
              account: 'Assets:Foo',
              amount: amount(1, 'CHF'),
              cost: null,
              flag: '!',
              meta: Map(),
            },
            {
              account: 'Assets:Bar',
              amount: amount(-1, 'CHF'),
              cost: null,
              flag: '*',
              meta: Map(),
            },
          ],
        },
        want: `\
2025-06-01 ! "Test"
  Assets:Foo 1.00 CHF
  * Assets:Bar -1.00 CHF`,
      },
    ];

    for (const t of tests) {
      await it(`formats the transaction [${t.name}]`, () => {
        const got = formatter.formatTransaction(t.transaction as Transaction);
        assert.equal(got, t.want);
      });
    }
  });
});
