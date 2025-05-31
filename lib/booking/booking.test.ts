import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { either as E, function as F } from 'fp-ts';
import { glob, readFile } from 'fs/promises';

import { load } from '../loading/loader.js';
import { book } from './booking.js';
import { BookedLedger } from './ledger.js';

await describe('book', async () => {
  const tests = [];
  const dirname = 'lib/booking/testdata/';
  for await (const f of glob([`${dirname}**/*.ledger`])) {
    tests.push({
      testName: f.replace(dirname, '').replace('.ledger', ''),
      srcPath: f,
      wantPath: f.replace('.ledger', '.json'),
    });
  }

  // Make sure we have test data
  assert(tests.length > 0);

  for (const t of tests) {
    await test(t.testName, async () => {
      const wantContent = await readFile(t.wantPath, { encoding: 'utf-8' });
      const ledger = await load(t.srcPath);
      assert(E.isRight(ledger));

      const got = F.pipe(
        book(ledger.right),
        E.bimap(
          ({ directive, message }) => ({
            error:
              `While processing '${directive.type}' directive at ` +
              `${directive.srcCtx.filePath}:${directive.srcCtx.row}: ${message}`,
          }),
          res => canonicalize(cleanup(res)),
        ),
      );

      assert.deepEqual(got, JSON.parse(wantContent), t.wantPath);
    });
  }
});

function cleanup(ledger: BookedLedger) {
  return {
    transactions: ledger.transactions.map(x => ({
      ...x,
      inventoriesBefore: undefined,
      inventoriesAfter: x.inventoriesAfter.map(x => x.getPositions()),
      srcCtx: undefined,
    })),
  };
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
