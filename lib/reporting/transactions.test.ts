import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { collectTests } from './internal/testing.js';
import { TransactionsReport } from './transactions.js';

await describe('InventoryReport', async () => {
  await describe('#run', async () => {
    await describe('without filters', async () => {
      const tests = await collectTests('transactions');
      for (const t of tests) {
        await it(t.testName, async () => {
          const got = new TransactionsReport({}).run(t.ledger);
          assert.equal(got.trim(), t.wantReport, t.wantPath);
        });
      }
    });

    await describe('with accounts filter', async () => {
      const tests = await collectTests('transactions-accounts-filter');
      for (const t of tests) {
        await it(t.testName, async () => {
          const got = new TransactionsReport({
            accounts: ['Assets:.*'],
          }).run(t.ledger);
          assert.equal(got.trim(), t.wantReport, t.wantPath);
        });
      }
    });

    await describe('with currencies filter', async () => {
      const tests = await collectTests('transactions-currencies-filter');
      for (const t of tests) {
        await it(t.testName, async () => {
          const got = new TransactionsReport({
            currencies: ['VT'],
          }).run(t.ledger);
          assert.equal(got.trim(), t.wantReport, t.wantPath);
        });
      }
    });

    await describe('with currencies filter', async () => {
      const tests = await collectTests('transactions-all-postings');
      for (const t of tests) {
        await it(t.testName, async () => {
          const got = new TransactionsReport({
            currencies: ['VT'],
            allPostings: true,
          }).run(t.ledger);
          assert.equal(got.trim(), t.wantReport, t.wantPath);
        });
      }
    });
  });
});
