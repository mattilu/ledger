import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { collectTests } from './internal/testing.js';
import { InventoryReport, InventoryReportOptions } from './inventory.js';

await describe('InventoryReport', async () => {
  await describe('#run', async () => {
    const testCases: Array<{
      name: string;
      scenario: string;
      options: InventoryReportOptions;
    }> = [
      { name: 'without filters', scenario: 'inventory', options: {} },
      {
        name: 'with accounts filter',
        scenario: 'inventory-accounts-filter',
        options: { accounts: ['Assets:.*', 'Trading:.*'] },
      },
      {
        name: 'with excludeAccounts filter',
        scenario: 'inventory-exclude-accounts-filter',
        options: { excludeAccounts: ['Trading:.*'] },
      },
      {
        name: 'with currencies filter',
        scenario: 'inventory-currencies-filter',
        options: { currencies: ['CHF'] },
      },
      {
        name: 'hide-cost',
        scenario: 'inventory-hide-cost',
        options: {
          formatOptions: { showCost: false },
        },
      },
    ];

    for (const testCase of testCases) {
      await describe(testCase.name, async () => {
        const tests = await collectTests(testCase.scenario);
        for (const t of tests) {
          await it(t.testName, async () => {
            const got = new InventoryReport(testCase.options).run(t.ledger);
            assert.equal(got.trim(), t.wantReport, t.wantPath);
          });
        }
      });
    }
  });
});
