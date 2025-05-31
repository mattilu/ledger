import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { either as E, function as F } from 'fp-ts';
import { glob, readFile } from 'fs/promises';

import { parse } from './parser.js';
import { LedgerSpec } from './spec/ledger.js';

await describe('parse', async () => {
  const tests = [];
  const dirname = 'lib/parsing/testdata/';
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
      const srcContent = await readFile(t.srcPath, { encoding: 'utf-8' });
      const wantContent = await readFile(t.wantPath, { encoding: 'utf-8' });
      const got = F.pipe(
        parse(srcContent),
        E.bimap(
          err => ({
            error: `${err.message} at ${t.srcPath}:${err.srcPos.row}`,
          }),
          res => canonicalize(cleanup(res)),
        ),
      );

      assert.deepEqual(got, JSON.parse(wantContent), t.wantPath);
    });
  }
});

function cleanup(ledger: LedgerSpec) {
  return {
    directives: ledger.directives.map(x => ({ ...x, srcPos: undefined })),
  };
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
