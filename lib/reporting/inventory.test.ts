import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { collectTests } from './internal/testing.js';
import { InventoryReport } from './inventory.js';

await describe('InventoryReport', async () => {
  await describe('#run', async () => {
    await describe('without filters', async () => {
      const tests = await collectTests('inventory');
      for (const t of tests) {
        await it(t.testName, async () => {
          const got = new InventoryReport({}).run(t.ledger);
          assert.equal(got, t.wantReport, t.wantPath);
        });
      }
    });

    await describe('with accounts filter', async () => {
      const tests = await collectTests('inventory-accounts-filter');
      for (const t of tests) {
        await it(t.testName, async () => {
          const got = new InventoryReport({
            accounts: ['Assets:.*', 'Trading:.*'],
          }).run(t.ledger);
          assert.equal(got, t.wantReport, t.wantPath);
        });
      }
    });
  });
});
