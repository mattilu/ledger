import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { inspect } from 'node:util';

import { ExactNumber } from 'exactnumber';

import { Amount } from './amount.js';

await describe('Amount', async () => {
  const amount = (amount: number | string, currency: string) =>
    new Amount(ExactNumber(amount), currency);

  await describe('#zero', async () => {
    await it('returns an amount with zero value', () => {
      assert(Amount.zero('USD').amount.isZero());
    });

    await it('returns an amount with the given currency', () => {
      assert.equal(Amount.zero('USD').currency, 'USD');
    });
  });

  await describe('#isZero', async () => {
    await it('returns true for a zero amount', () => {
      assert(Amount.zero('USD').isZero());
    });

    await it('returns false for a positive amount', () => {
      assert(!amount(1, 'USD').isZero());
    });

    await it('returns false for a negative amount', () => {
      assert(!amount(-1, 'USD').isZero());
    });
  });

  await describe('#isPos', async () => {
    await it('returns true when value is positive', () => {
      assert.equal(amount(1, 'USD').isPos(), true);
    });

    await it('returns false when value is negative', () => {
      assert.equal(amount(-1, 'USD').isPos(), false);
    });

    await it('returns false when value is zero', () => {
      assert.equal(amount(0, 'USD').isPos(), false);
    });
  });

  await describe('#isNeg', async () => {
    await it('returns true when value is negative', () => {
      assert.equal(amount(-1, 'USD').isNeg(), true);
    });

    await it('returns false when value is positive', () => {
      assert.equal(amount(1, 'USD').isNeg(), false);
    });

    await it('returns false when value is zero', () => {
      assert.equal(amount(0, 'USD').isNeg(), false);
    });
  });

  await describe('#eq', async () => {
    await it('requires operands to have the same Currency', () => {
      assert.throws(() => {
        amount(1, 'USD').eq(amount(1, 'EUR'));
      }, /invalid 'eq' operation between currencies 'USD' and 'EUR'/i);
    });

    await it('returns true when operands have the same value', () => {
      assert.equal(amount(1, 'USD').eq(amount(1, 'USD')), true);
    });

    await it('returns false when operands have different values', () => {
      assert.equal(amount(1, 'USD').eq(amount(2, 'USD')), false);
    });
  });

  await describe('#lt', async () => {
    await it('requires operands to have the same Currency', () => {
      assert.throws(() => {
        amount(1, 'USD').lt(amount(1, 'EUR'));
      }, /invalid 'lt' operation between currencies 'USD' and 'EUR'/i);
    });

    await it('returns true when value is lesser than operand', () => {
      assert.equal(amount(1, 'USD').lt(amount(2, 'USD')), true);
    });

    await it('returns false when value is greater than operand', () => {
      assert.equal(amount(2, 'USD').lt(amount(1, 'USD')), false);
    });

    await it('returns false when value is equal to operand', () => {
      assert.equal(amount(1, 'USD').lt(amount(1, 'USD')), false);
    });
  });

  await describe('#lte', async () => {
    await it('requires operands to have the same Currency', () => {
      assert.throws(() => {
        amount(1, 'USD').lte(amount(1, 'EUR'));
      }, /invalid 'lte' operation between currencies 'USD' and 'EUR'/i);
    });

    await it('returns true when value is lesser than operand', () => {
      assert.equal(amount(1, 'USD').lte(amount(2, 'USD')), true);
    });

    await it('returns false when value is greater than operand', () => {
      assert.equal(amount(2, 'USD').lte(amount(1, 'USD')), false);
    });

    await it('returns true when value is equal to operand', () => {
      assert.equal(amount(1, 'USD').lte(amount(1, 'USD')), true);
    });
  });

  await describe('#gt', async () => {
    await it('requires operands to have the same Currency', () => {
      assert.throws(() => {
        amount(1, 'USD').gt(amount(1, 'EUR'));
      }, /invalid 'gt' operation between currencies 'USD' and 'EUR'/i);
    });

    await it('returns true when value is greater than operand', () => {
      assert.equal(amount(2, 'USD').gt(amount(1, 'USD')), true);
    });

    await it('returns false when value is lesser than operand', () => {
      assert.equal(amount(1, 'USD').gt(amount(2, 'USD')), false);
    });

    await it('returns false when value is equal to operand', () => {
      assert.equal(amount(1, 'USD').gt(amount(1, 'USD')), false);
    });
  });

  await describe('#gte', async () => {
    await it('requires operands to have the same Currency', () => {
      assert.throws(() => {
        amount(1, 'USD').gte(amount(1, 'EUR'));
      }, /invalid 'gte' operation between currencies 'USD' and 'EUR'/i);
    });

    await it('returns true when value is greater than operand', () => {
      assert.equal(amount(2, 'USD').gte(amount(1, 'USD')), true);
    });

    await it('returns false when value is lesser than operand', () => {
      assert.equal(amount(1, 'USD').gte(amount(2, 'USD')), false);
    });

    await it('returns true when value is equal to operand', () => {
      assert.equal(amount(1, 'USD').gte(amount(1, 'USD')), true);
    });
  });

  await describe('#neg', async () => {
    await it('returns an Amount with the same Currency', () => {
      assert.equal(amount(1, 'USD').neg().currency, 'USD');
    });

    await it('returns an Amount with the negated value when positive', () => {
      assert(amount(1, 'USD').neg().amount.eq(-1));
    });

    await it('returns an Amount with the negated value when negative', () => {
      assert(amount(-1, 'USD').neg().amount.eq(1));
    });
  });

  await describe('#abs', async () => {
    await it('returns an Amount with the same Currency', () => {
      assert.equal(amount(1, 'USD').abs().currency, 'USD');
    });

    await it('returns an Amount with the same value when positive', () => {
      assert(amount(1, 'USD').abs().amount.eq(1));
    });

    await it('returns an Amount with the negated value when negative', () => {
      assert(amount(-1, 'USD').abs().amount.eq(1));
    });
  });

  await describe('#add', async () => {
    await it('requires operands to have the same Currency', () => {
      assert.throws(() => {
        amount(1, 'USD').add(amount(1, 'EUR'));
      }, /invalid 'add' operation between currencies 'USD' and 'EUR'/i);
    });

    await it('returns an Amount with the same Currency', () => {
      assert.equal(amount(1, 'USD').add(amount(2, 'USD')).currency, 'USD');
    });

    await it('returns an Amount with the sum of the values', () => {
      assert(amount(1, 'USD').add(amount(2, 'USD')).amount.eq(3));
    });

    await it('has exact precision', () => {
      assert(amount('0.1', 'USD').add(amount('0.2', 'USD')).amount.eq('0.3'));
    });
  });

  await describe('#sub', async () => {
    await it('requires operands to have the same Currency', () => {
      assert.throws(() => {
        amount(1, 'USD').sub(amount(1, 'EUR'));
      }, /invalid 'sub' operation between currencies 'USD' and 'EUR'/i);
    });

    await it('returns an Amount with the same Currency', () => {
      assert.equal(amount(3, 'USD').sub(amount(2, 'USD')).currency, 'USD');
    });

    await it('returns an Amount with the difference of the values', () => {
      assert(amount(3, 'USD').sub(amount(2, 'USD')).amount.eq(1));
    });

    await it('has exact precision', () => {
      assert(amount('0.3', 'USD').sub(amount('0.2', 'USD')).amount.eq('0.1'));
    });
  });

  await describe('#mul', async () => {
    await it('returns an Amount with the same Currency', () => {
      assert.equal(amount(1, 'USD').mul(ExactNumber(2)).currency, 'USD');
    });

    await it('returns an Amount with the product of the values', () => {
      assert(amount(2, 'USD').mul(ExactNumber(3)).amount.eq(6));
    });

    await it('has exact precision', () => {
      assert(amount('0.2', 'USD').mul(ExactNumber('0.3')).amount.eq('0.06'));
    });
  });

  await describe('#div', async () => {
    await it('returns an Amount with the same Currency', () => {
      assert.equal(amount(1, 'USD').div(ExactNumber(2)).currency, 'USD');
    });

    await it('returns an Amount with the division of the values', () => {
      assert(amount(3, 'USD').div(ExactNumber(2)).amount.eq('1.5'));
    });

    await it('has exact precision', () => {
      assert(amount(2, 'USD').div(ExactNumber(3)).amount.eq('0.(6)'));
    });
  });

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
