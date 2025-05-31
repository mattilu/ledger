import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExactNumber } from 'exactnumber';
import { either as E } from 'fp-ts';

import { Amount } from '../../core/amount.js';
import { Cost } from '../cost.js';
import { Inventory } from '../inventory.js';
import { Position } from '../position.js';
import { BookedPosting } from '../transaction.js';
import { FIFO } from './fifo.js';

const amount = (n: number | string, currency: string) =>
  new Amount(ExactNumber(n), currency);

const cost = (n: number | string, currency: string, date: Date) =>
  new Cost([amount(n, currency)], date);

const position = (amount: Amount, cost?: Cost) =>
  new Position(amount, cost ?? null);

const inventory = (positions: Position[]) =>
  Inventory.Empty.addPositions(positions);

const posting = (
  account: string,
  amount: Amount,
  cost: Cost | null,
): BookedPosting => ({
  account,
  amount,
  cost,
});

const TestAccount = 'Assets:Test';
const CHF = 'CHF';
const USD = 'USD';

await describe('FIFO', async () => {
  await describe('#book', async () => {
    await it('returns no posting when amount is zero', () => {
      const inventory0 = inventory([]);
      const got = FIFO.book(TestAccount, amount(0, CHF), inventory0);
      assert.deepEqual(got, E.right([[], inventory0]));
    });

    await it('fully reduces the oldest value of the inventory', () => {
      const inventory0 = inventory([
        position(
          amount(1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount(-1, USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
      ];

      const wantInventory = inventory([
        position(
          amount(1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('partially reduces the oldest value of the inventory', () => {
      const inventory0 = inventory([
        position(
          amount(1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount('-0.5', USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount('-0.5', USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
      ];

      const wantInventory = inventory([
        position(
          amount('0.5', USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('reduces multiple values of the inventory, oldest first', () => {
      const inventory0 = inventory([
        position(
          amount(1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.3', CHF, new Date('2025-04-03T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount('-2.5', USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
        posting(
          TestAccount,
          amount('-0.5', USD),
          cost('1.3', CHF, new Date('2025-04-03T00:00:00Z')),
        ),
      ];

      const wantInventory = inventory([
        position(
          amount('0.5', USD),
          cost('1.3', CHF, new Date('2025-04-03T00:00:00Z')),
        ),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('fully reduces multiple postings', () => {
      const inventory0 = inventory([
        position(
          amount(1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.3', CHF, new Date('2025-04-03T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount(-3, USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1.3', CHF, new Date('2025-04-03T00:00:00Z')),
        ),
      ];

      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('fails when there are not enough positions to reduce', () => {
      const inventory0 = inventory([
        position(
          amount(1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount('-1.1', USD), inventory0);

      assert(E.isLeft(got));
      assert.match(
        got.left.message,
        /not enough positions to reduce: -0.1 USD from Assets:Test/i,
      );
    });

    await it('ignores positions not held at cost', () => {
      const inventory0 = inventory([position(amount(1, USD))]);
      const got = FIFO.book(TestAccount, amount(-1, USD), inventory0);

      assert(E.isLeft(got));
      assert.match(
        got.left.message,
        /not enough positions to reduce: -1 USD from Assets:Test/i,
      );
    });

    await it('ignores positions that would not be reduced', () => {
      const inventory0 = inventory([
        position(
          amount(-1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
        position(
          amount(1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount(-1, USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(-1, USD),
          cost('1.2', CHF, new Date('2025-04-02T00:00:00Z')),
        ),
      ];

      const wantInventory = inventory([
        position(
          amount(-1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
      ]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('correctly books positive amounts', () => {
      const inventory0 = inventory([
        position(
          amount(-1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount(1, USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(1, USD),
          cost('1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
      ];

      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });

    await it('correctly books negative costs', () => {
      const inventory0 = inventory([
        position(
          amount(1, USD),
          cost('-1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
      ]);
      const got = FIFO.book(TestAccount, amount(-1, USD), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(-1, USD),
          cost('-1.1', CHF, new Date('2025-04-01T00:00:00Z')),
        ),
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
          ),
        ),
      ]);

      const got = FIFO.book(TestAccount, amount(-2, 'ETHBTC-LP'), inventory0);

      const wantPostings = [
        posting(
          TestAccount,
          amount(-2, 'ETHBTC-LP'),
          new Cost(
            [amount(1, 'BTC'), amount(20, 'ETH')],
            new Date('2025-04-01T00:00:00Z'),
          ),
        ),
      ];
      const wantInventory = inventory([]);

      assert.deepEqual(got, E.right([wantPostings, wantInventory]));
    });
  });
});
