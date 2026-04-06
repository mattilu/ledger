import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { collectTests } from './internal/testing.js';
import {
  UnrealizedPnlReport,
  UnrealizedPnlReportOptions,
} from './unrealized-pnl.js';

await describe('UnrealizedPnlReport', async () => {
  await describe('#run', async () => {
    const testCases: Array<{
      name: string;
      scenario: string;
      options: UnrealizedPnlReportOptions;
    }> = [
      {
        name: 'baseline',
        scenario: 'unrealized-pnl-baseline',
        options: {},
      },
      {
        name: 'aggregate',
        scenario: 'unrealized-pnl-aggregate',
        options: {
          formatOptions: { aggregate: true },
        },
      },
      {
        name: 'accounts filter',
        scenario: 'unrealized-pnl-accounts-filter',
        options: {
          accounts: ['Assets:Brokerage:Bar.*'],
        },
      },
      {
        name: 'exclude accounts filter',
        scenario: 'unrealized-pnl-accounts-filter',
        options: {
          excludeAccounts: ['Assets:Brokerage:Foo.*'],
        },
      },
      {
        name: 'currencies filter',
        scenario: 'unrealized-pnl-currencies-filter',
        options: {
          currencies: ['EUR'],
        },
      },
      {
        name: 'tree baseline',
        scenario: 'unrealized-pnl-tree-baseline',
        options: {
          formatOptions: { tree: true },
        },
      },
      {
        name: 'tree aggregate',
        scenario: 'unrealized-pnl-tree-aggregate',
        options: {
          formatOptions: { tree: true, aggregate: true },
        },
      },
      {
        name: 'tree show totals',
        scenario: 'unrealized-pnl-tree-totals',
        options: {
          formatOptions: { tree: true, showTotals: true },
        },
      },
      {
        name: 'tree show totals, aggregate',
        scenario: 'unrealized-pnl-tree-totals-aggregate',
        options: {
          formatOptions: { tree: true, showTotals: true, aggregate: true },
        },
      },
      {
        name: 'tree max depth',
        scenario: 'unrealized-pnl-tree-max-depth',
        options: {
          formatOptions: { tree: true, maxDepth: 2 },
        },
      },
      {
        name: 'tree max depth aggregate',
        scenario: 'unrealized-pnl-tree-max-depth-aggregate',
        options: {
          formatOptions: { tree: true, maxDepth: 2, aggregate: true },
        },
      },
    ];

    for (const testCase of testCases) {
      await describe(testCase.name, async () => {
        const tests = await collectTests(testCase.scenario);
        for (const t of tests) {
          await it(t.testName, async () => {
            const got = new UnrealizedPnlReport(testCase.options).run(t.ledger);
            assert.equal(got.trim(), t.wantReport, t.wantPath);
          });
        }
      });
    }
  });
});
