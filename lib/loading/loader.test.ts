import { strict as assert } from 'node:assert';
import { basename } from 'node:path';
import { describe, test } from 'node:test';

import { bimap, isLeft } from 'fp-ts/lib/Either.js';
import { pipe } from 'fp-ts/lib/function.js';
import { glob, readFile } from 'fs/promises';

import { Ledger } from './ledger.js';
import { load } from './loader.js';

const loadForTest = async (path: string) =>
  pipe(
    await load(path),
    bimap(
      err => ({
        error: `${err.message} at ${err.srcCtx.filePath}:${err.srcCtx.row}`,
      }),
      res => canonicalize(cleanup(res)),
    ),
  );

await describe('load', async () => {
  const tests = [];
  const dirname = 'lib/loading/testdata/';
  for await (const f of glob([`${dirname}**/*.ledger`], {
    exclude: f => basename(f).startsWith('_'),
  })) {
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
      const got = await loadForTest(t.srcPath);
      assert.deepEqual(got, JSON.parse(wantContent), t.wantPath);
    });
  }

  await test('non-existing file', async () => {
    const got = await loadForTest('non-existing.ledger');
    assert(isLeft(got));
    assert.match(got.left.error, /no such file or directory/);
  });
});

function cleanup(ledger: Ledger) {
  return {
    directives: ledger.directives.map(x => ({
      ...x,
      srcCtx: undefined,
    })),
  };
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
