import { strict as assert } from 'node:assert';
import { basename } from 'node:path';
import { describe, test } from 'node:test';

import { either as E, function as F } from 'fp-ts';
import { glob, readFile } from 'fs/promises';

import { Directive } from './directive.js';
import { CurrencyDirective } from './directives/currency.js';
import { Posting } from './directives/transaction.js';
import { Ledger } from './ledger.js';
import { load } from './loader.js';
import { Metadata } from './metadata.js';

type TestOptions = {
  readonly compareOptionMap?: boolean;
};

const loadForTest = async (path: string, options?: TestOptions) =>
  F.pipe(
    await load(path),
    E.bimap(
      err => ({
        error: `${err.message} at ${err.srcCtx.filePath}:${err.srcCtx.row}`,
      }),
      res => canonicalize(cleanup(res, options)),
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
      const { want, options } = JSON.parse(
        await readFile(t.wantPath, { encoding: 'utf-8' }),
      );
      const got = await loadForTest(t.srcPath, options);
      assert.deepEqual(got, want, t.wantPath);
    });
  }

  await test('non-existing file', async () => {
    const got = await loadForTest('non-existing.ledger');
    assert(E.isLeft(got));
    assert.match(got.left.error, /no such file or directory/);
  });
});

function cleanup(ledger: Ledger, options?: TestOptions) {
  function cleanupDirective(directive: Directive | CurrencyDirective) {
    return {
      ...directive,
      postings:
        directive.type === 'transaction'
          ? directive.postings.map(cleanupPosting)
          : undefined,
      balances:
        directive.type === 'balance'
          ? directive.balances.map(b => ({
              ...b,
              approx: b.approx?.toNumber(),
            }))
          : undefined,
      srcCtx: undefined,
      meta: cleanupMeta(directive.meta),
      optionMap: options?.compareOptionMap ? directive.optionMap : undefined,
    };
  }

  function cleanupPosting(posting: Posting) {
    return {
      ...posting,
      meta: cleanupMeta(posting.meta),
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

  return {
    directives: ledger.directives.map(directive => cleanupDirective(directive)),
    currencyMap: ledger.currencyMap.isEmpty()
      ? undefined
      : ledger.currencyMap.map(directive => cleanupDirective(directive)),
  };
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
