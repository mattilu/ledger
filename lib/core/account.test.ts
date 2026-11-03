import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { either as E } from 'fp-ts';

import {
  AccountType,
  getAccountType,
  getAccountTypeUnchecked,
  getDefaultNormalBalanceSide,
  NormalBalanceSide,
  parseNormalBalanceSide,
} from './account.js';

const AccountTypeTests: Array<{ account: string; want: AccountType }> = [
  { account: 'Assets', want: AccountType.Assets },
  { account: 'Assets:Checking', want: AccountType.Assets },
  { account: 'Equity', want: AccountType.Equity },
  { account: 'Equity:Opening-Balances', want: AccountType.Equity },
  { account: 'Expenses', want: AccountType.Expenses },
  { account: 'Expenses:Groceries', want: AccountType.Expenses },
  { account: 'Income', want: AccountType.Income },
  { account: 'Income:Salary', want: AccountType.Income },
  { account: 'Liabilities', want: AccountType.Liabilities },
  { account: 'Liabilities:Credit-Card', want: AccountType.Liabilities },
  { account: 'Trading', want: AccountType.Trading },
  { account: 'Trading:Forex', want: AccountType.Trading },
];

await describe('getAccountType', async () => {
  for (const { account, want } of AccountTypeTests) {
    await it(`determines the correct top level account type ["${account}" -> ${want}]"`, () => {
      assert.deepEqual(getAccountType(account), E.of(want));
    });
  }

  const errorTests = ['', 'Unknown', 'Unknown:Account'];
  for (const account of errorTests) {
    await it(`returns an error for invalid accounts [${account}]`, () => {
      const got = getAccountType(account);
      assert(E.isLeft(got));
      assert.match(got.left, /expected one of/);
    });
  }
});

await describe('getAccountTypeUnchecked', async () => {
  for (const { account, want } of AccountTypeTests) {
    await it(`determines the correct top level account type ["${account}" -> ${want}]"`, () => {
      assert.deepEqual(getAccountTypeUnchecked(account), want);
    });
  }
});

await describe('getDefaultNormalBalanceSide', async () => {
  const tests: Array<{ accountType: AccountType; want: NormalBalanceSide }> = [
    { accountType: AccountType.Assets, want: NormalBalanceSide.Debit },
    { accountType: AccountType.Liabilities, want: NormalBalanceSide.Credit },
    { accountType: AccountType.Equity, want: NormalBalanceSide.Credit },
    { accountType: AccountType.Income, want: NormalBalanceSide.Credit },
    { accountType: AccountType.Expenses, want: NormalBalanceSide.Debit },
    { accountType: AccountType.Trading, want: NormalBalanceSide.Credit },
  ];

  for (const { accountType, want } of tests) {
    await it(`maps each account type to its default normal side [${accountType} -> ${want}]`, () => {
      assert.deepEqual(getDefaultNormalBalanceSide(accountType), want);
    });
  }
});

await describe('parseNormalBalanceSide', async () => {
  const tests: Array<{ value: string; want: NormalBalanceSide }> = [
    { value: 'debit', want: NormalBalanceSide.Debit },
    { value: 'credit', want: NormalBalanceSide.Credit },
  ];
  for (const test of tests) {
    await it(`parses a valid value [${test.value}]`, () => {
      assert.deepEqual(parseNormalBalanceSide(test.value), E.of(test.want));
    });
  }

  await it('fails on an invalid value', () => {
    const got = parseNormalBalanceSide('invalid');
    assert(E.isLeft(got));
    assert.match(got.left, /expected one of/);
  });
});
