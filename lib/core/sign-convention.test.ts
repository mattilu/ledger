import { strict as assert } from 'node:assert';
import { describe, it, mock } from 'node:test';

import { ExactNumber } from 'exactnumber';
import { either as E } from 'fp-ts';
import { Map } from 'immutable';

import {
  AccountType,
  getDefaultNormalBalanceSide,
  NormalBalanceSide,
} from './account.js';
import { Amount } from './amount.js';
import {
  CanonicalAmountConverter,
  NormalBalanceOverrides,
  parseSignConvention,
  SignConvention,
} from './sign-convention.js';

describe('parseSignConvention', () => {
  const tests = [
    { value: 'legacy', want: SignConvention.Legacy },
    { value: 'beancount', want: SignConvention.Beancount },
    {
      value: 'normal-balance-positive',
      want: SignConvention.NormalBalancePositive,
    },
    {
      value: 'net-worth-positive',
      want: SignConvention.NetWorthPositive,
    },
  ];

  for (const test of tests) {
    it(`parses known sign conventions [${test.value}]`, () => {
      assert.deepEqual(parseSignConvention(test.value), E.of(test.want));
    });
  }

  it('rejects unknown sign conventions', () => {
    const got = parseSignConvention('unknown');
    assert(E.isLeft(got));
    assert.match(got.left, /expected one of/);
  });
});

describe('CanonicalAmountConverter', () => {
  describe('#getNormalBalanceSide', () => {
    it('resolves to the default normal balance side for root account types', () => {
      const converter = new CanonicalAmountConverter(Map());

      for (const account of [
        AccountType.Assets,
        AccountType.Liabilities,
        AccountType.Equity,
        AccountType.Income,
        AccountType.Expenses,
      ] as const)
        assert.equal(
          converter.getNormalBalanceSide(account),
          getDefaultNormalBalanceSide(account),
        );
    });

    it('resolves account sides from the nearest ancestor override', () => {
      const converter = new CanonicalAmountConverter(
        Map([
          ['Assets:Foo', NormalBalanceSide.Credit],
          ['Assets:Foo:Bar:Baz', NormalBalanceSide.Debit],
        ]),
      );

      const tests = [
        { account: 'Liabilities', want: NormalBalanceSide.Credit },
        { account: 'Income', want: NormalBalanceSide.Credit },
        { account: 'Assets', want: NormalBalanceSide.Debit },
        { account: 'Assets:Foo', want: NormalBalanceSide.Credit },
        { account: 'Assets:Foo:Bar', want: NormalBalanceSide.Credit },
        { account: 'Assets:Foo:Bar:Baz', want: NormalBalanceSide.Debit },
        { account: 'Assets:Foo:Bar:Baz:Qux', want: NormalBalanceSide.Debit },
        { account: 'Assets:Bar', want: NormalBalanceSide.Debit },
      ];

      for (const test of tests) {
        assert.equal(converter.getNormalBalanceSide(test.account), test.want);
      }
    });

    it('caches results until clearCache() is called', () => {
      const overrides: NormalBalanceOverrides = Map([
        ['Assets:Foo', NormalBalanceSide.Debit],
      ]);
      const converter = new CanonicalAmountConverter(overrides);
      const mockGet = mock.method(overrides, 'get');

      // Trigger calls for Assets:Foo:Bar and Assets:Foo.
      converter.getNormalBalanceSide('Assets:Foo:Bar');

      assert.equal(mockGet.mock.callCount(), 2);
      assert.deepEqual(mockGet.mock.calls[0].arguments, ['Assets:Foo:Bar']);
      assert.deepEqual(mockGet.mock.calls[1].arguments, ['Assets:Foo']);

      mockGet.mock.resetCalls();

      // Call it again.
      converter.getNormalBalanceSide('Assets:Foo:Bar');

      // No new calls should have been made, as results are cached.
      assert.equal(mockGet.mock.callCount(), 0);

      // Clear cache and call again
      converter.clearCache();
      converter.getNormalBalanceSide('Assets:Foo:Bar');

      // Two new calls are made
      assert.equal(mockGet.mock.callCount(), 2);
    });
  });

  describe('#convert and #getConvertFn', () => {
    const one = new Amount(ExactNumber(1), 'USD');
    const minusOne = one.neg();

    const converter = new CanonicalAmountConverter(
      Map([
        ['Assets:Contra', NormalBalanceSide.Credit],
        ['Liabilities:Contra', NormalBalanceSide.Debit],
        ['Equity:Contra', NormalBalanceSide.Debit],
        ['Income:Contra', NormalBalanceSide.Debit],
        ['Expenses:Contra', NormalBalanceSide.Credit],
        ['Trading:Contra', NormalBalanceSide.Debit],
      ]),
    );

    describe('legacy|beancount', () => {
      for (const account of [
        'Assets',
        'Liabilities',
        'Equity',
        'Income',
        'Expenses',
        'Trading',
        'Assets:Contra',
        'Liabilities:Contra',
        'Equity:Contra',
        'Income:Contra',
        'Expenses:Contra',
        'Trading:Contra',
      ]) {
        it(`Converts 1 USD to 1 USD for ${account}`, () => {
          assert.deepEqual(
            converter.convert(one, SignConvention.Legacy, account),
            one,
          );
          assert.deepEqual(
            converter.convert(one, SignConvention.Beancount, account),
            one,
          );

          assert.deepEqual(
            converter.getConvertFn(SignConvention.Legacy, account)(one),
            one,
          );
          assert.deepEqual(
            converter.getConvertFn(SignConvention.Beancount, account)(one),
            one,
          );
        });
      }
    });

    describe('normal-balance-positive', () => {
      const tests: Array<{ account: string; want: Amount }> = [
        { account: 'Assets', want: one },
        { account: 'Liabilities', want: minusOne },
        { account: 'Equity', want: minusOne },
        { account: 'Income', want: minusOne },
        { account: 'Expenses', want: one },
        { account: 'Trading', want: minusOne },
        { account: 'Assets:Contra', want: minusOne },
        { account: 'Liabilities:Contra', want: one },
        { account: 'Equity:Contra', want: one },
        { account: 'Income:Contra', want: one },
        { account: 'Expenses:Contra', want: minusOne },
        { account: 'Trading:Contra', want: one },
      ];

      for (const test of tests) {
        it(`Converts ${one} to ${test.want.toString().padStart(6)} for ${test.account}`, () => {
          assert.deepEqual(
            converter.convert(
              one,
              SignConvention.NormalBalancePositive,
              test.account,
            ),
            test.want,
          );
          assert.deepEqual(
            converter.getConvertFn(
              SignConvention.NormalBalancePositive,
              test.account,
            )(one),
            test.want,
          );
        });
      }
    });

    describe('net-worth-positive', () => {
      const tests: Array<{ account: string; want: Amount }> = [
        { account: 'Assets', want: one },
        { account: 'Liabilities', want: one },
        { account: 'Equity', want: minusOne },
        { account: 'Income', want: minusOne },
        { account: 'Expenses', want: minusOne },
        { account: 'Trading', want: minusOne },
        { account: 'Assets:Contra', want: one },
        { account: 'Liabilities:Contra', want: one },
        { account: 'Equity:Contra', want: minusOne },
        { account: 'Income:Contra', want: minusOne },
        { account: 'Expenses:Contra', want: minusOne },
        { account: 'Trading:Contra', want: minusOne },
      ];

      for (const test of tests) {
        it(`Converts ${one} to ${test.want.toString().padStart(6)} for ${test.account}`, () => {
          assert.deepEqual(
            converter.convert(
              one,
              SignConvention.NetWorthPositive,
              test.account,
            ),
            test.want,
          );
          assert.deepEqual(
            converter.getConvertFn(
              SignConvention.NetWorthPositive,
              test.account,
            )(one),
            test.want,
          );
        });
      }
    });
  });
});
