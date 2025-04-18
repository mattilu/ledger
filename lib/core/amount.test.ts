import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { inspect } from 'node:util';

import { ExactNumber } from 'exactnumber';

import { Amount } from './amount.js';

await describe('Amount', async () => {
  const amount = (amount: number | string, currency: string) =>
    new Amount(ExactNumber(amount), currency);

  await describe('#toString', async () => {
    const tests: Array<{ amount: Amount; want: string }> = [
      { amount: amount('1', 'USD'), want: '1 USD' },
      { amount: amount('1/2', 'USD'), want: '0.5 USD' },
      { amount: amount('1/3', 'USD'), want: '0.(3) USD' },
      { amount: amount('2/3', 'USD'), want: '0.(6) USD' },
      { amount: amount('1/4', 'USD'), want: '0.25 USD' },
      { amount: amount('1/5', 'USD'), want: '0.2 USD' },
      { amount: amount('1/6', 'USD'), want: '0.1(6) USD' },
      { amount: amount('1/7', 'USD'), want: '0.(142857) USD' },
      { amount: amount('1/8', 'USD'), want: '0.125 USD' },
      { amount: amount('1/9', 'USD'), want: '0.(1) USD' },
      { amount: amount('1/10', 'USD'), want: '0.1 USD' },
      { amount: amount('10', 'USD'), want: '10 USD' },
      { amount: amount('100', 'USD'), want: '100 USD' },
      { amount: amount('1000', 'USD'), want: '1000 USD' },
    ];

    for (const t of tests) {
      await it(`converts to a string [${t.amount.amount}]`, () => {
        assert.equal(t.amount.toString(), t.want);
      });
    }
  });

  await describe('#toJson', async () => {
    await it('converts to an object with amount and currency', () => {
      assert.deepEqual(amount('1/3', 'USD').toJSON(), {
        amount: '0.(3)',
        currency: 'USD',
      });
    });
  });

  await describe('inspect', async () => {
    await it('converts to a string', () => {
      assert.equal(inspect(amount('1/3', 'USD')), '0.(3) USD');
    });
  });
});
