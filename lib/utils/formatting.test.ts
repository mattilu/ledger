import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExactNumber } from 'exactnumber';
import { Map } from 'immutable';

import { Cost } from '../booking/cost.js';
import { Inventory, InventoryMap } from '../booking/inventory.js';
import { Position } from '../booking/position.js';
import { Transaction } from '../booking/transaction.js';
import { Amount } from '../core/amount.js';
import { CurrencyDirective } from '../loading/directives/currency.js';
import {
  FormatBalanceMode,
  FormatInventoriesOptions,
  Formatter,
  FormatTransactionOptions,
} from './formatting.js';

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
      options?: FormatTransactionOptions;
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
      {
        name: 'show balance',
        transaction: {
          date: new Date('2025-11-01'),
          description: 'Test',
          flag: '*',
          postings: [
            {
              account: 'Assets:Test:Foo',
              amount: amount(1, 'CHF'),
              cost: null,
              flag: '*',
              meta: Map(),
            },
            {
              account: 'Assets:Test:Bar',
              amount: amount(2, 'CHF'),
              cost: null,
              flag: '*',
              meta: Map(),
            },
          ],
          inventoriesBefore: Map(),
        },
        options: { formatBalance: FormatBalanceMode.Full },
        want: `\
2025-11-01 * "Test"
  Assets:Test:Foo 1.00 CHF
  ; 1.00 CHF
  Assets:Test:Bar 2.00 CHF
  ; 2.00 CHF`,
      },
      {
        name: 'show balance, full, with multiple postings on same account',
        transaction: {
          date: new Date('2025-11-01'),
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
              amount: amount(2, 'CHF'),
              cost: null,
              flag: '*',
              meta: Map(),
            },
          ],
          inventoriesBefore: Map(),
        },
        options: { formatBalance: FormatBalanceMode.Full },
        want: `\
2025-11-01 * "Test"
  Assets:Test 1.00 CHF
  ; 1.00 CHF
  Assets:Test 2.00 CHF
  ; 3.00 CHF`,
      },
      {
        name: 'show balance, full, with amount and cost on same account',
        transaction: {
          date: new Date('2025-11-01'),
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
              amount: amount(2, 'CHF'),
              cost: cost([amount(2, 'USD')], '2025-11-01'),
              flag: '*',
              meta: Map(),
            },
          ],
          inventoriesBefore: Map(),
        },
        options: { formatBalance: FormatBalanceMode.Full },
        want: `\
2025-11-01 * "Test"
  Assets:Test 1.00 CHF
  ; 1.00 CHF
  Assets:Test 2.00 CHF { 2 USD, 2025-11-01 }
  ; 1.00 CHF
  ; 2.00 CHF { 2 USD, 2025-11-01 }`,
      },
      {
        name: 'show balance, aggregate, with amount and cost on same account',
        transaction: {
          date: new Date('2025-11-01'),
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
              amount: amount(2, 'CHF'),
              cost: cost([amount(2, 'USD')], '2025-11-01'),
              flag: '*',
              meta: Map(),
            },
          ],
          inventoriesBefore: Map(),
        },
        options: { formatBalance: FormatBalanceMode.Aggregate },
        want: `\
2025-11-01 * "Test"
  Assets:Test 1.00 CHF
  ; 1.00 CHF
  Assets:Test 2.00 CHF { 2 USD, 2025-11-01 }
  ; 3.00 CHF`,
      },
      {
        name: 'show balance, with initial inventory',
        transaction: {
          date: new Date('2025-11-01'),
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
          ],
          inventoriesBefore: Map([
            ['Assets:Test', Inventory.Empty.addAmount(amount(1, 'CHF'))],
          ]),
        },
        options: { formatBalance: FormatBalanceMode.Full },
        want: `\
2025-11-01 * "Test"
  Assets:Test 1.00 CHF
  ; 2.00 CHF`,
      },
    ];

    for (const t of tests) {
      await it(`formats the transaction [${t.name}]`, () => {
        const got = formatter.formatTransaction(
          t.transaction as Transaction,
          t.options,
        );
        assert.equal(got, t.want);
      });
    }
  });

  await describe('#formatInventories', async () => {
    const inventories = (<K extends string>(r: Record<K, InventoryMap>) => r)({
      empty: Map(),
      topLevelAccount: Map([
        ['Assets', Inventory.Empty.addAmount(amount(1, 'CHF'))],
      ]),
      childAccount: Map([
        ['Assets:Test', Inventory.Empty.addAmount(amount(1, 'CHF'))],
      ]),
      accountWithZeroValue: Map([['Assets:Test:Foo', Inventory.Empty]]),
      deepAccount: Map([
        [
          'Assets:Test:Foo:Bar:Baz',
          Inventory.Empty.addAmount(amount(1, 'CHF')),
        ],
      ]),
      multipleAccounts: Map([
        ['Assets:Test:Foo', Inventory.Empty.addAmount(amount(1, 'CHF'))],
        ['Assets:Test:Bar', Inventory.Empty.addAmount(amount(1, 'EUR'))],
        ['Assets:Test:Baz', Inventory.Empty.addAmount(amount(1, 'JPY'))],
        ['Liabilities:Test:Qux', Inventory.Empty.addAmount(amount(1, 'USD'))],
      ]),
      multiplePositions: Map([
        [
          'Assets:Test',
          Inventory.Empty.addAmounts([
            amount(1, 'CHF'),
            amount(1, 'EUR'),
            amount(1, 'USD'),
          ]),
        ],
      ]),
      costs: Map([
        [
          'Assets:Test:Trading',
          Inventory.Empty.addPositions([
            new Position(
              amount(1, 'QQQ'),
              cost([amount(500, 'CHF')], '2025-11-01'),
            ),
            new Position(
              amount(1, 'VT'),
              cost([amount(140, 'CHF')], '2025-11-02'),
            ),
            new Position(
              amount(1, 'VT'),
              cost([amount(150, 'CHF')], '2025-11-01'),
            ),
          ]),
        ],
      ]),
    });

    const tests: Array<{
      name: string;
      inventories: InventoryMap;
      options?: FormatInventoriesOptions;
      want: string;
    }> = [
      {
        name: 'empty',
        inventories: inventories.empty,
        want: '',
      },
      {
        name: 'top level account',
        inventories: inventories.topLevelAccount,
        want: 'Assets 1.00 CHF',
      },
      {
        name: 'child account',
        inventories: inventories.childAccount,
        want: 'Assets:Test 1.00 CHF',
      },
      {
        name: 'deep account',
        inventories: inventories.deepAccount,
        want: 'Assets:Test:Foo:Bar:Baz 1.00 CHF',
      },
      {
        name: 'account with zero value',
        inventories: inventories.accountWithZeroValue,
        want: '',
      },
      {
        name: 'multiple accounts',
        inventories: inventories.multipleAccounts,
        want: `\
Assets:Test:Bar 1 EUR
Assets:Test:Baz 1 JPY
Assets:Test:Foo 1.00 CHF
Liabilities:Test:Qux 1 USD`,
      },
      {
        name: 'multiple positions',
        inventories: inventories.multiplePositions,
        want: `\
Assets:Test 1.00 CHF
Assets:Test 1 EUR
Assets:Test 1 USD`,
      },
      {
        name: 'costs',
        inventories: inventories.costs,
        want: `\
Assets:Test:Trading 1 QQQ { 500.00 CHF, 2025-11-01 }
Assets:Test:Trading 1 VT { 150.00 CHF, 2025-11-01 }
Assets:Test:Trading 1 VT { 140.00 CHF, 2025-11-02 }`,
      },
      {
        name: 'costs hidden',
        inventories: inventories.costs,
        options: { showCost: false },
        want: `\
Assets:Test:Trading 1 QQQ
Assets:Test:Trading 2 VT`,
      },
      {
        name: 'empty as tree',
        inventories: Map(),
        options: { tree: true },
        want: '╿',
      },
      {
        name: 'top level account as tree',
        inventories: inventories.topLevelAccount,
        options: { tree: true },
        want: `\
╿
└─ Assets  1.00 CHF`,
      },
      {
        name: 'child account as tree',
        inventories: inventories.childAccount,
        options: { tree: true },
        want: `\
╿
└─ Assets
   └─ Test  1.00 CHF`,
      },
      {
        name: 'account with zero value as tree',
        inventories: inventories.accountWithZeroValue,
        options: { tree: true },
        want: '╿',
      },
      {
        name: 'deep account as tree',
        inventories: inventories.deepAccount,
        options: { tree: true },
        want: `\
╿
└─ Assets
   └─ Test
      └─ Foo
         └─ Bar
            └─ Baz  1.00 CHF`,
      },
      {
        name: 'deep account as tree, max depth',
        inventories: inventories.deepAccount,
        options: { tree: true, maxDepth: 2 },
        want: `\
╿
└─ Assets
   └─ Test  1.00 CHF`,
      },
      {
        name: 'multiple accounts as tree',
        inventories: inventories.multipleAccounts,
        options: { tree: true },
        want: `\
╿
├─ Assets
│  └─ Test
│     ├─ Bar    1 EUR
│     ├─ Baz    1 JPY
│     └─ Foo    1.00 CHF
└─ Liabilities
   └─ Test
      └─ Qux    1 USD`,
      },
      {
        name: 'multiple accounts as tree, max depth',
        inventories: inventories.multipleAccounts,
        options: { tree: true, maxDepth: 2 },
        want: `\
╿
├─ Assets
│  └─ Test      1.00 CHF
│     │         1 EUR
│     └         1 JPY
└─ Liabilities
   └─ Test      1 USD`,
      },
      {
        name: 'multiple accounts as tree, show totals',
        inventories: inventories.multipleAccounts,
        options: { tree: true, showTotals: true },
        want: `\
╿               1.00 CHF
│               1 EUR
│               1 JPY
│               1 USD
├─ Assets       1.00 CHF
│  │            1 EUR
│  │            1 JPY
│  └─ Test      1.00 CHF
│     │         1 EUR
│     │         1 JPY
│     ├─ Bar    1 EUR
│     ├─ Baz    1 JPY
│     └─ Foo    1.00 CHF
└─ Liabilities  1 USD
   └─ Test      1 USD
      └─ Qux    1 USD`,
      },
      {
        name: 'multiple accounts as tree, max depth, show totals',
        inventories: inventories.multipleAccounts,
        options: { tree: true, maxDepth: 2, showTotals: true },
        want: `\
╿               1.00 CHF
│               1 EUR
│               1 JPY
│               1 USD
├─ Assets       1.00 CHF
│  │            1 EUR
│  │            1 JPY
│  └─ Test      1.00 CHF
│     │         1 EUR
│     └         1 JPY
└─ Liabilities  1 USD
   └─ Test      1 USD`,
      },
      {
        name: 'multiple positions as tree',
        inventories: inventories.multiplePositions,
        options: { tree: true },
        want: `\
╿
└─ Assets
   └─ Test  1.00 CHF
      │     1 EUR
      └     1 USD`,
      },
      {
        name: 'costs as tree',
        inventories: inventories.costs,
        options: { tree: true },
        want: `\
╿
└─ Assets
   └─ Test
      └─ Trading  1 QQQ { 500.00 CHF, 2025-11-01 }
         │        1 VT { 150.00 CHF, 2025-11-01 }
         └        1 VT { 140.00 CHF, 2025-11-02 }`,
      },
      {
        name: 'costs as tree, max depth',
        inventories: inventories.costs,
        options: { tree: true, maxDepth: 2 },
        want: `\
╿
└─ Assets
   └─ Test  1 QQQ { 500.00 CHF, 2025-11-01 }
      │     1 VT { 150.00 CHF, 2025-11-01 }
      └     1 VT { 140.00 CHF, 2025-11-02 }`,
      },
      {
        name: 'costs as tree, show totals',
        inventories: inventories.costs,
        options: { tree: true, showTotals: true },
        want: `\
╿                 1 QQQ { 500.00 CHF, 2025-11-01 }
│                 1 VT { 150.00 CHF, 2025-11-01 }
│                 1 VT { 140.00 CHF, 2025-11-02 }
└─ Assets         1 QQQ { 500.00 CHF, 2025-11-01 }
   │              1 VT { 150.00 CHF, 2025-11-01 }
   │              1 VT { 140.00 CHF, 2025-11-02 }
   └─ Test        1 QQQ { 500.00 CHF, 2025-11-01 }
      │           1 VT { 150.00 CHF, 2025-11-01 }
      │           1 VT { 140.00 CHF, 2025-11-02 }
      └─ Trading  1 QQQ { 500.00 CHF, 2025-11-01 }
         │        1 VT { 150.00 CHF, 2025-11-01 }
         └        1 VT { 140.00 CHF, 2025-11-02 }`,
      },
      {
        name: 'costs hidden as tree',
        inventories: inventories.costs,
        options: { tree: true, showCost: false },
        want: `\
╿
└─ Assets
   └─ Test
      └─ Trading  1 QQQ
         └        2 VT`,
      },
      {
        name: 'costs hidden as tree, show totals',
        inventories: inventories.costs,
        options: { tree: true, showCost: false, showTotals: true },
        want: `\
╿                 1 QQQ
│                 2 VT
└─ Assets         1 QQQ
   │              2 VT
   └─ Test        1 QQQ
      │           2 VT
      └─ Trading  1 QQQ
         └        2 VT`,
      },
    ];

    for (const t of tests) {
      await it(`formats the inventories [${t.name}]`, () => {
        const got = formatter.formatInventories(t.inventories, t.options);
        assert.equal(got, t.want);
      });
    }
  });
});
