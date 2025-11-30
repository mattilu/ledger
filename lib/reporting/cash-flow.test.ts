import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CashFlowReport, CashFlowReportOptions } from './cash-flow.js';
import { collectTests } from './internal/testing.js';

await describe('CashFlowReport', async () => {
  await describe('#run', async () => {
    const testCases: Array<{
      name: string;
      scenario: string;
      options: CashFlowReportOptions;
    }> = [
      {
        name: 'baseline',
        scenario: 'cash-flow-baseline',
        options: {},
      },
      {
        name: 'hide cost',
        scenario: 'cash-flow-hide-cost',
        options: {
          formatOptions: { showCost: false },
        },
      },
      {
        name: 'accounts filter',
        scenario: 'cash-flow-accounts-filter',
        options: {
          accounts: ['Assets:Bank.*'],
        },
      },
      {
        name: 'from-date filter',
        scenario: 'cash-flow-from-date',
        options: {
          dateFrom: new Date('2025-11-04T00:00:00Z'),
        },
      },
      {
        name: 'show from accounts',
        scenario: 'cash-flow-show-from-accounts',
        options: {
          dateFrom: new Date('2025-11-04T00:00:00Z'),
          showFromAccounts: true,
        },
      },
      {
        name: 'tree baseline',
        scenario: 'cash-flow-tree-baseline',
        options: {
          formatOptions: { tree: true },
        },
      },
      {
        name: 'tree hide cost',
        scenario: 'cash-flow-tree-hide-cost',
        options: {
          formatOptions: { tree: true, showCost: false },
        },
      },
      {
        name: 'tree show from accounts',
        scenario: 'cash-flow-tree-show-from-accounts',
        options: {
          dateFrom: new Date('2025-11-04T00:00:00Z'),
          showFromAccounts: true,
          formatOptions: { tree: true },
        },
      },
      {
        name: 'tree show totals',
        scenario: 'cash-flow-tree-totals',
        options: {
          formatOptions: { tree: true, showTotals: true },
        },
      },
      {
        name: 'tree show totals, hide cost',
        scenario: 'cash-flow-tree-totals-hide-cost',
        options: {
          formatOptions: { tree: true, showTotals: true, showCost: false },
        },
      },
      {
        name: 'tree max depth',
        scenario: 'cash-flow-tree-max-depth',
        options: {
          formatOptions: { tree: true, maxDepth: 2 },
        },
      },
      {
        name: 'tree max depth hide cost',
        scenario: 'cash-flow-tree-max-depth-hide-cost',
        options: {
          formatOptions: { tree: true, maxDepth: 2, showCost: false },
        },
      },
    ];

    for (const testCase of testCases) {
      await describe(testCase.name, async () => {
        const tests = await collectTests(testCase.scenario);
        for (const t of tests) {
          await it(t.testName, async () => {
            const got = new CashFlowReport(testCase.options).run(t.ledger);
            assert.equal(got.trim(), t.wantReport, t.wantPath);
          });
        }
      });
    }
  });
});
