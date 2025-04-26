import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { inspect } from 'node:util';

import { ExactNumber } from 'exactnumber';

import { Amount } from '../core/amount.js';
import { Cost } from './cost.js';
import { Inventory } from './inventory.js';
import { Position } from './position.js';

const amount = (n: number | string, currency: string) =>
  new Amount(ExactNumber(n), currency);
const cost = (amounts: Amount[], timestamp = 0) =>
  new Cost(amounts, new Date(timestamp));
const position = (amount: Amount, cost: Cost | null = null) =>
  new Position(amount, cost);

await describe('Inventory', async () => {
  await describe('#isEmpty', async () => {
    await it('returns true for an empty inventory', () => {
      assert(Inventory.Empty.isEmpty());
    });

    await it('returns false for a non-empty inventory', () => {
      assert(Inventory.Empty.addAmount(amount(1, 'USD')));
    });
  });

  await describe('#getPositions', async () => {
    await it('returns empty array for empty inventory', () => {
      assert.deepEqual(Inventory.Empty.getPositions(), []);
    });

    await it('returns an array of positions in the inventory', () => {
      const inventory = Inventory.Empty.addAmounts([
        amount(1, 'USD'),
        amount(-1, 'EUR'),
      ]);

      const got = inventory.getPositions();
      const want = [position(amount(-1, 'EUR')), position(amount(1, 'USD'))];

      assert.deepEqual(new Set(got), new Set(want));
    });
  });

  await describe('#addAmount', async () => {
    await it('ignores zero amounts', () => {
      const inventory = Inventory.Empty.addAmount(amount(0, 'USD'));
      assert(inventory.isEmpty());
    });

    await it('creates a new (positive) amount in an empty inventory', () => {
      const inventory = Inventory.Empty.addAmount(amount(1, 'USD'));
      assert.deepEqual(inventory.getPositions(), [position(amount(1, 'USD'))]);
    });

    await it('creates a new (negative) amount in an empty inventory', () => {
      const inventory = Inventory.Empty.addAmount(amount(-1, 'USD'));
      assert.deepEqual(inventory.getPositions(), [position(amount(-1, 'USD'))]);
    });

    await it('updates an existing amount with a positive amount', () => {
      const inventory0 = Inventory.Empty.addAmount(amount(1, 'USD'));
      const inventory1 = inventory0.addAmount(amount(2, 'USD'));
      assert.deepEqual(inventory1.getPositions(), [position(amount(3, 'USD'))]);
    });

    await it('deletes an existing amount with an opposite amount', () => {
      const inventory0 = Inventory.Empty.addAmount(amount(1, 'USD'));
      const inventory1 = inventory0.addAmount(amount(-1, 'USD'));
      assert(inventory1.isEmpty());
    });
  });

  await describe('#addPosition', async () => {
    await it('ignores zero amounts', () => {
      const inventory = Inventory.Empty.addPosition(
        position(amount(0, 'USD'), cost([amount(1, 'CHF')], 0)),
      );
      assert(inventory.isEmpty());
    });

    await it('creates a new (positive) position in an empty inventory', () => {
      const inventory = Inventory.Empty.addPosition(
        position(amount(1, 'USD'), cost([amount(1, 'CHF')])),
      );
      assert.deepEqual(inventory.getPositions(), [
        position(amount(1, 'USD'), cost([amount(1, 'CHF')])),
      ]);
    });

    await it('creates a new (negative) position in an empty inventory', () => {
      const inventory = Inventory.Empty.addPosition(
        position(amount(-1, 'USD'), cost([amount(1, 'CHF')])),
      );
      assert.deepEqual(inventory.getPositions(), [
        position(amount(-1, 'USD'), cost([amount(1, 'CHF')])),
      ]);
    });

    await it('updates an existing position with a positive position', () => {
      const inventory0 = Inventory.Empty.addPosition(
        position(amount(1, 'USD'), cost([amount(1, 'CHF')])),
      );
      const inventory1 = inventory0.addPosition(
        position(amount(2, 'USD'), cost([amount(1, 'CHF')])),
      );
      assert.deepEqual(inventory1.getPositions(), [
        position(amount(3, 'USD'), cost([amount(1, 'CHF')])),
      ]);
    });

    await it('deletes an existing position with an opposite amount', () => {
      const inventory0 = Inventory.Empty.addPosition(
        position(amount(1, 'USD'), cost([amount(1, 'CHF')])),
      );
      const inventory1 = inventory0.addPosition(
        position(amount(-1, 'USD'), cost([amount(1, 'CHF')])),
      );
      assert(inventory1.isEmpty());
    });
  });

  {
    const tests: Array<{
      name: string;
      inventory: Inventory;
      wantString: string;
      wantInspect: string;
    }> = [
      {
        name: 'empty',
        inventory: Inventory.Empty,
        wantString: '',
        wantInspect: '[]',
      },
      {
        name: 'one position',
        inventory: Inventory.Empty.addAmount(amount(10, 'EUR')),
        wantString: '10 EUR',
        wantInspect: '[ 10 EUR ]',
      },
      {
        name: 'multiple positions',
        inventory: Inventory.Empty.addAmounts([
          amount(10, 'EUR'),
          amount(20, 'CHF'),
        ]),
        wantString: '20 CHF\n10 EUR',
        wantInspect: '[ 20 CHF, 10 EUR ]',
      },
    ];

    await describe('#toString', async () => {
      for (const t of tests) {
        await it(`converts to a string [${t.name}]`, () => {
          assert.equal(t.inventory.toString(), t.wantString);
        });
      }
    });

    await describe('inspect', async () => {
      for (const t of tests) {
        await it(`converts to a string [${t.name}]`, () => {
          assert.equal(inspect(t.inventory), t.wantInspect);
        });
      }
    });
  }
});
