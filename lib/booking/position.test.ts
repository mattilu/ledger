import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { inspect } from 'node:util';

import { ExactNumber } from 'exactnumber';

import { Amount } from '../core/amount.js';
import { Cost } from './cost.js';
import { Position } from './position.js';

await describe('Position', async () => {
  const tests: Array<{ name: string; position: Position; want: string }> = [
    {
      name: 'without-cost',
      position: new Position(new Amount(ExactNumber(2), 'USD'), null),
      want: '2 USD',
    },
    {
      name: 'with-cost',
      position: new Position(
        new Amount(ExactNumber(2), 'USD'),
        new Cost(
          [new Amount(ExactNumber(3), 'EUR')],
          new Date('2023-05-01 00:00:00 Z'),
        ),
      ),
      want: '2 USD { 3 EUR, 2023-05-01T00:00:00.000Z }',
    },
  ];

  await describe('#toString', async () => {
    for (const t of tests) {
      await it(`converts to a string [${t.name}]`, () => {
        assert.equal(t.position.toString(), t.want);
      });
    }
  });

  await describe('inspect', async () => {
    for (const t of tests) {
      await it(`converts to a string [${t.name}]`, () => {
        assert.equal(inspect(t.position), t.want);
      });
    }
  });
});
