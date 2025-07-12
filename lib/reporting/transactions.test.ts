import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { collectTests } from './internal/testing.js';
import {
  TransactionsReport,
  TransactionsReportOptions,
} from './transactions.js';

await describe('InventoryReport', async () => {
  await describe('#run', async () => {
    const testCases: Array<{
      name: string;
      scenario: string;
      options: TransactionsReportOptions;
    }> = [
      { name: 'without filters', scenario: 'transactions', options: {} },
      {
        name: 'with dateFrom filter (before transaction)',
        scenario: 'transactions-date-from-lte',
        options: { dateFrom: new Date('2025-01-04T23:59:59Z') },
      },
      {
        name: 'with dateFrom filter (at transaction)',
        scenario: 'transactions-date-from-lte',
        options: { dateFrom: new Date('2025-01-05T00:00:00Z') },
      },
      {
        name: 'with dateFrom filter (after transaction)',
        scenario: 'transactions-date-from-gt',
        options: { dateFrom: new Date('2025-01-05T00:00:01Z') },
      },
      {
        name: 'with accounts filter',
        scenario: 'transactions-accounts-filter',
        options: { accounts: ['Assets:.*'] },
      },
      {
        name: 'with excludeAccounts filter',
        scenario: 'transactions-exclude-accounts-filter',
        options: { excludeAccounts: ['Trading:.*'] },
      },
      {
        name: 'with currencies filter',
        scenario: 'transactions-currencies-filter',
        options: { currencies: ['VT'] },
      },
      {
        name: 'with flags filter',
        scenario: 'transactions-flags-filter',
        options: { flags: ['!'] },
      },
      {
        name: 'with all postings',
        scenario: 'transactions-all-postings',
        options: { currencies: ['VT'], allPostings: true },
      },
    ];

    for (const testCase of testCases) {
      await describe(testCase.name, async () => {
        const tests = await collectTests(testCase.scenario);
        for (const t of tests) {
          await it(t.testName, async () => {
            const got = new TransactionsReport(testCase.options).run(t.ledger);
            assert.equal(got.trim(), t.wantReport, t.wantPath);
          });
        }
      });
    }
  });
});
