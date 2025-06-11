import { strict as assert } from 'node:assert';
import { basename } from 'node:path';
import { describe, test } from 'node:test';

import { either as E, function as F } from 'fp-ts';
import { glob, readFile } from 'fs/promises';

import { Directive } from './directive.js';
import { CurrencyDirective } from './directives/currency.js';
import { Ledger } from './ledger.js';
import { load } from './loader.js';
import { Metadata } from './metadata.js';

const loadForTest = async (path: string) =>
  F.pipe(
    await load(path),
    E.bimap(
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
    assert(E.isLeft(got));
    assert.match(got.left.error, /no such file or directory/);
  });
});

function cleanup(ledger: Ledger) {
  return {
    directives: ledger.directives.map(cleanupDirective),
    currencyMap: ledger.currencyMap.isEmpty()
      ? undefined
      : ledger.currencyMap.map(cleanupDirective),
  };
}

function cleanupDirective(directive: Directive | CurrencyDirective) {
  return {
    ...directive,
    postings:
      directive.type === 'transaction'
        ? directive.postings.map(p => ({ ...p, meta: cleanupMeta(p.meta) }))
        : undefined,
    srcCtx: undefined,
    meta: cleanupMeta(directive.meta),
  };
}

function cleanupMeta(meta: Metadata) {
  if (meta.isEmpty()) {
    return undefined;
  }
  return meta.map(value => ({
    type: value.type,
    value: value.type === 'number' ? value.value.toNumber() : value.value,
  }));
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
