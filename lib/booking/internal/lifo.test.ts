import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExactNumber } from 'exactnumber';
import { either as E } from 'fp-ts';
import { Map } from 'immutable';

import { Amount } from '../../core/amount.js';
import { Metadata } from '../../loading/metadata.js';
import { Cost } from '../cost.js';
import { Inventory } from '../inventory.js';
import { Position } from '../position.js';
import { BookedPosting } from '../transaction.js';
import { LIFO } from './lifo.js';

const amount = (n: number | string, currency: string) =>
  new Amount(ExactNumber(n), currency);

const cost = (n: number | string, currency: string, date: string) =>
  new Cost(
    [amount(n, currency)],
    new Date(`${date}T00:00:00Z`),
    { date, time: null, timezone: null },
    [],
  );

const position = (amount: Amount, cost?: Cost) =>
  new Position(amount, cost ?? null);

const inventory = (positions: Position[]) =>
  Inventory.Empty.addPositions(positions);

const posting = (
  account: string,
  amount: Amount,
  cost: Cost | null,
  flag = '*',
  meta: Metadata = Map(),
): BookedPosting => ({
  account,
  flag,
  amount,
  cost,
  meta,
});

const TestAccount = 'Assets:Test';
const CHF = 'CHF';
const USD = 'USD';

const book = (
  amount: Amount,
  inventory: Inventory,
  options?: {
    account?: string;
    flag?: string;
    meta?: Metadata;
  },
) =>
  LIFO.book(
    options?.account ?? TestAccount,
    options?.flag ?? '*',
    options?.meta ?? Map(),
    amount,
    inventory,
  );

await describe('LIFO', async () => {
  await describe('#book', async () => {
    await it('returns no posting when amount is zero', () => {
      const inventory0 = inventory([]);
      const got = book(amount(0, CHF), inventory0);
      assert.deepEqual(got, E.right([[], inventory0]));
    });

    await it('fully reduces the newest value of the inventory', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('1.1', CHF, '2025-04-01')),
        position(amount(1, USD), cost('1.2', CHF, '2025-04-02')),
      ]);
      const got = book(amount(-1, USD), inventory0);

      const wantPostings = [
        posting(TestAccount, amount(-1, USD), cost('1.2', CHF, '2025-04-02')),
      ];

      const wantInventory = inventory([
        position(amount(1, USD), cost('1.1', CHF, '2025-04-01')),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('partially reduces the newest value of the inventory', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('1.1', CHF, '2025-04-01')),
        position(amount(1, USD), cost('1.2', CHF, '2025-04-02')),
      ]);
      const got = book(amount('-0.5', USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount('-0.5', USD),
          cost('1.2', CHF, '2025-04-02'),
        ),
      ];

      const wantInventory = inventory([
        position(amount(1, USD), cost('1.1', CHF, '2025-04-01')),
        position(amount('0.5', USD), cost('1.2', CHF, '2025-04-02')),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('reduces multiple values of the inventory, newest first', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('1.1', CHF, '2025-04-01')),
        position(amount(1, USD), cost('1.2', CHF, '2025-04-02')),
        position(amount(1, USD), cost('1.3', CHF, '2025-04-03')),
      ]);
      const got = book(amount('-2.6', USD), inventory0);

      const wantPostings = [
        posting(TestAccount, amount(-1, USD), cost('1.3', CHF, '2025-04-03')),
        posting(TestAccount, amount(-1, USD), cost('1.2', CHF, '2025-04-02')),
        posting(
          TestAccount,
          amount('-0.6', USD),
          cost('1.1', CHF, '2025-04-01'),
        ),
      ];

      const wantInventory = inventory([
        position(amount('0.4', USD), cost('1.1', CHF, '2025-04-01')),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('fully reduces multiple postings', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('1.1', CHF, '2025-04-01')),
        position(amount(1, USD), cost('1.2', CHF, '2025-04-02')),
        position(amount(1, USD), cost('1.3', CHF, '2025-04-03')),
      ]);
      const got = book(amount(-3, USD), inventory0);

      const wantPostings = [
        posting(TestAccount, amount(-1, USD), cost('1.3', CHF, '2025-04-03')),
        posting(TestAccount, amount(-1, USD), cost('1.2', CHF, '2025-04-02')),
        posting(TestAccount, amount(-1, USD), cost('1.1', CHF, '2025-04-01')),
      ];

      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('fails when there are not enough positions to reduce', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('1.1', CHF, '2025-04-01')),
      ]);
      const got = book(amount('-1.1', USD), inventory0);

      assert(E.isLeft(got));
      assert.match(
        got.left.message,
        /not enough positions to reduce: -0.1 USD from Assets:Test/i,
      );
    });

    await it('ignores positions not held at cost', () => {
      const inventory0 = inventory([position(amount(1, USD))]);
      const got = book(amount(-1, USD), inventory0);

      assert(E.isLeft(got));
      assert.match(
        got.left.message,
        /not enough positions to reduce: -1 USD from Assets:Test/i,
      );
    });

    await it('ignores positions that would not be reduced', () => {
      const inventory0 = inventory([
        position(amount(-1, USD), cost('1.1', CHF, '2025-04-01')),
        position(amount(1, USD), cost('1.2', CHF, '2025-04-02')),
      ]);
      const got = book(amount(-1, USD), inventory0);

      const wantPostings = [
        posting(TestAccount, amount(-1, USD), cost('1.2', CHF, '2025-04-02')),
      ];

      const wantInventory = inventory([
        position(amount(-1, USD), cost('1.1', CHF, '2025-04-01')),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('correctly books positive costs', () => {
      const inventory0 = inventory([
        position(amount(-1, USD), cost('1.1', CHF, '2025-04-01')),
      ]);
      const got = book(amount(1, USD), inventory0);

      const wantPostings = [
        posting(TestAccount, amount(1, USD), cost('1.1', CHF, '2025-04-01')),
      ];

      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('correctly books negative costs', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('-1.1', CHF, '2025-04-01')),
      ]);
      const got = book(amount(-1, USD), inventory0);

      const wantPostings = [
        posting(TestAccount, amount(-1, USD), cost('-1.1', CHF, '2025-04-01')),
      ];
      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('correctly books costs with multiple amounts', () => {
      const inventory0 = inventory([
        position(
          amount(2, 'ETHBTC-LP'),
          new Cost(
            [amount(1, 'BTC'), amount(20, 'ETH')],
            new Date('2025-04-01T00:00:00Z'),
            { date: '2025-04-01', time: null, timezone: null },
            [],
          ),
        ),
      ]);

      const got = book(amount(-2, 'ETHBTC-LP'), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(-2, 'ETHBTC-LP'),
          new Cost(
            [amount(1, 'BTC'), amount(20, 'ETH')],
            new Date('2025-04-01T00:00:00Z'),
            { date: '2025-04-01', time: null, timezone: null },
            [],
          ),
        ),
      ];
      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('propagates the flag', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('1', CHF, '2025-06-01')),
      ]);
      const got = book(amount(-1, USD), inventory0, { flag: '!' });

      const wantPostings = [
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1', CHF, '2025-06-01'),
          '!',
        ),
      ];

      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('propagates the metadata', () => {
      const inventory0 = inventory([
        position(amount(1, USD), cost('1', CHF, '2025-06-01')),
      ]);
      const got = book(amount(-1, USD), inventory0, {
        meta: Map([['test-key', { type: 'string', value: 'test-value' }]]),
      });

      const wantPostings = [
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1', CHF, '2025-06-01'),
          '*',
          Map([['test-key', { type: 'string', value: 'test-value' }]]),
        ),
      ];

      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });
  });
});
