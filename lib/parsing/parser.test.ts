import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { either as E, function as F } from 'fp-ts';
import { glob, readFile } from 'fs/promises';

import { parse } from './parser.js';
import { LedgerSpec } from './spec/ledger.js';
import { MetadataSpec } from './spec/metadata.js';

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
    await test(t.testName, async ctx => {
      const srcContent = await readFile(t.srcPath, { encoding: 'utf-8' });
      const got = F.pipe(
        parse(srcContent),
        E.bimap(
          err => ({
            error: `${err.message} at ${t.srcPath}:${err.srcPos.row}`,
          }),
          res => canonicalize(cleanup(res)),
        ),
      );

      ctx.assert.fileSnapshot(got, t.wantPath, {
        serializers: [x => JSON.stringify(x, null, 2) + '\n'],
      });
    });
  }

  for (const keyword of ['and', 'or', 'not', 'is']) {
    await test(`rejects reserved keyword '${keyword}' as condition attribute`, () => {
      const got = parse(
        `account-rule "r" {\n  when ${keyword} is debit: Income:Foo\n}\n`,
      );
      assert(E.isLeft(got));
    });

    await test(`rejects reserved keyword '${keyword}' as unquoted condition literal`, () => {
      const got = parse(
        `account-rule "r" {\n  when direction == ${keyword}: Income:Foo\n}\n`,
      );
      assert(E.isLeft(got));
    });

    await test(`allows '${keyword}' as quoted string condition literal`, () => {
      const got = parse(
        `account-rule "r" {\n  when label == "${keyword}": Income:Foo\n}\n`,
      );
      assert(E.isRight(got));
    });
  }
});

function cleanup(ledger: LedgerSpec) {
  return {
    directives: ledger.directives.map(x => ({
      ...x,
      postings:
        x.type === 'transaction'
          ? x.postings.map(p => ({ ...p, meta: cleanupMeta(p.meta) }))
          : undefined,
      srcPos: undefined,
      meta: cleanupMeta(x.meta),
    })),
  };
}

function cleanupMeta(meta: MetadataSpec) {
  if (meta.isEmpty()) {
    return undefined;
  }
  return meta;
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
