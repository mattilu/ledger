import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { bimap } from 'fp-ts/lib/Either.js';
import { pipe } from 'fp-ts/lib/function.js';
import { glob, readFile } from 'fs/promises';

import { Ledger } from './ledger.js';
import { load } from './loader.js';

await describe('load', async () => {
  const tests = [];
  const dirname = 'lib/loading/testdata/';
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
      const got = pipe(
        await load(t.srcPath),
        bimap(
          err => ({
            error: `${err.message} at ${err.srcCtx.filePath}:${err.srcCtx.row}`,
          }),
          res => canonicalize(cleanup(res)),
        ),
      );

      assert.deepEqual(got, JSON.parse(wantContent));
    });
  }
});

function cleanup(ledger: Ledger) {
  return {
    directives: ledger.directives.map(x => ({ ...x, srcCtx: undefined })),
  };
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
