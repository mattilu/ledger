import { strict as assert } from 'node:assert';
import test, { describe, it } from 'node:test';
import { inspect } from 'node:util';

import { ExactNumber } from 'exactnumber';

import { Amount } from '../core/amount.js';
import { Cost } from './cost.js';

await describe('Cost', async () => {
  const tests: Array<{ name: string; cost: Cost; want: string }> = [
    {
      name: 'single-amount',
      cost: new Cost(
        [new Amount(ExactNumber(2), 'USD')],
        new Date('2023-05-01T00:00:00Z'),
        { date: '2023-05-01', time: null, timezone: null },
        [],
      ),
      want: '{ 2 USD, 2023-05-01T00:00:00.000Z }',
    },
    {
      name: 'multiple-amount',
      cost: new Cost(
        [new Amount(ExactNumber(1), 'BTC'), new Amount(ExactNumber(20), 'ETH')],
        new Date('2023-05-01T00:00:00Z'),
        { date: '2023-05-01', time: null, timezone: null },
        [],
      ),
      want: '{ 1 BTC, 20 ETH, 2023-05-01T00:00:00.000Z }',
    },
    {
      name: 'tags',
      cost: new Cost(
        [new Amount(ExactNumber(2), 'USD')],
        new Date('2025-08-01T00:00:00Z'),
        { date: '2025-08-01', time: null, timezone: null },
        ['tag-1', 'tag-2'],
      ),
      want: '{ 2 USD, 2025-08-01T00:00:00.000Z, "tag-1", "tag-2" }',
    },
  ];

  await test('cannot construct with empty amounts', async () => {
    assert.throws(() => {
      new Cost([], new Date(), { date: '', time: null, timezone: null }, []);
    }, /Cost amounts must not be empty/i);
  });

  await describe('#toString', async () => {
    for (const t of tests) {
      await it(`converts to a string [${t.name}]`, () => {
        assert.equal(t.cost.toString(), t.want);
      });
    }
  });

  await describe('inspect', async () => {
    for (const t of tests) {
      await it(`converts to a string [${t.name}]`, () => {
        assert.equal(inspect(t.cost), t.want);
      });
    }
  });
});
