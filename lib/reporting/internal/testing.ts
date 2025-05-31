import { strict as assert } from 'node:assert';

import { either as E, function as F } from 'fp-ts';
import { glob, readFile } from 'fs/promises';
import path, { dirname } from 'path';

import { book } from '../../booking/booking.js';
import { BookedLedger } from '../../booking/ledger.js';
import { load } from '../../loading/loader.js';

export interface TestCase {
  readonly testName: string;
  readonly ledger: BookedLedger;
  readonly wantPath: string;
  readonly wantReport: string;
}

export async function collectTests(scenario: string): Promise<TestCase[]> {
  const tests: TestCase[] = [];

  const dataDir = 'lib/reporting/testdata/';
  for await (const wantPath of glob([`${dataDir}**/${scenario}.txt`])) {
    const testName = dirname(wantPath.replace(dataDir, ''));
    const srcPath = path.join(dataDir, testName, 'main.ledger');
    const wantContent = await readFile(wantPath, { encoding: 'utf-8' });

    const got = F.pipe(await load(srcPath), E.flatMap(book));
    assert(E.isRight(got));

    tests.push({
      testName,
      ledger: got.right,
      wantPath,
      wantReport: wantContent.trim(),
    });
  }

  assert(tests.length > 0, `no test cases found for '${scenario}'`);

  return tests;
}
