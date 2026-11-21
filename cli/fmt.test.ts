import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';

import { parse } from 'cmd-ts';
import { either as E } from 'fp-ts';

import { app } from './app.js';
import {
  CONFIG_FILENAME,
  discoverConfigPath,
  FmtCliArgs,
  FmtIo,
  runFmt,
} from './fmt.js';

function makeArgs(overrides: Partial<FmtCliArgs> = {}): FmtCliArgs {
  return {
    files: [],
    write: false,
    check: false,
    ...overrides,
  };
}

function makeIo(opts?: { readonly cwd?: string; readonly stdin?: string }): {
  readonly io: FmtIo;
  readonly getStdout: () => string;
} {
  const chunks: string[] = [];
  return {
    io: {
      cwd: () => opts?.cwd ?? process.cwd(),
      readStdin: async () => opts?.stdin ?? '',
      writeStdout: text => {
        chunks.push(text);
      },
    },
    getStdout: () => chunks.join(''),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'ledger-fmt-test-'),
  );
  try {
    await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

await describe('cli fmt', async () => {
  await test('parses fmt subcommand flags via cmd-ts', async () => {
    const parsed = await parse(app, [
      'fmt',
      '--check',
      '--indent-width',
      '4',
      '--align-scope',
      'file-grow-only',
      '--align-mode',
      'decimal-and-currency',
      '--align-trailing-comments',
      '--thousands-separator',
      'add',
      'a.ledger',
      'b.ledger',
    ]);
    assert.equal(parsed._tag, 'ok');

    const parsedExplicitFalse = await parse(app, [
      'fmt',
      '--align-trailing-comments=false',
      'a.ledger',
    ]);
    assert.equal(parsedExplicitFalse._tag, 'ok');
  });

  await test('formats stdin to stdout when no files or "-" is passed', async () => {
    const messy = `2026-05-01 * "Coffee"
    Assets:Cash    -4.50 USD
    Expenses:Coffee
`;
    const expected = `2026-05-01 * "Coffee"
  Assets:Cash  -4.50 USD
  Expenses:Coffee
`;

    const { io, getStdout } = makeIo({ stdin: messy });
    const res = await runFmt(makeArgs(), io);
    assert(E.isRight(res));
    assert.equal(getStdout(), expected);

    const dashIo = makeIo({ stdin: messy });
    const dashRes = await runFmt(makeArgs({ files: ['-'] }), dashIo.io);
    assert(E.isRight(dashRes));
    assert.equal(dashIo.getStdout(), expected);
  });

  await test('discovers .ledgerfmt.json upward and applies CLI flag overrides', async () => {
    await withTempDir(async root => {
      const nested = path.join(root, 'books', '2026');
      await fs.promises.mkdir(nested, { recursive: true });

      await fs.promises.writeFile(
        path.join(root, CONFIG_FILENAME),
        JSON.stringify({
          indentWidth: 4,
          thousandsSeparator: 'add',
          transactionFlagStyle: 'txn',
        }),
        'utf8',
      );

      assert.equal(
        discoverConfigPath(nested),
        path.join(root, CONFIG_FILENAME),
      );

      const input = `2026-05-01 * "Salary"
  Assets:Bank  5000.00 USD
  Income:Salary
`;

      // Using upward discovery via --stdin-filepath:
      const { io, getStdout } = makeIo({ cwd: root, stdin: input });
      const res = await runFmt(
        makeArgs({
          stdinFilepath: path.join(nested, 'may.ledger'),
          // Override transactionFlagStyle from CLI while keeping indentWidth=4 and thousandsSeparator='add' from config:
          transactionFlagStyle: 'star',
        }),
        io,
      );
      assert(E.isRight(res));
      assert.equal(
        getStdout(),
        `2026-05-01 * "Salary"
    Assets:Bank  5,000.00 USD
    Income:Salary
`,
      );
    });
  });

  await test('supports --write in-place formatting and --check verification', async () => {
    await withTempDir(async dir => {
      const fileA = path.join(dir, 'a.ledger');
      const fileB = path.join(dir, 'b.ledger');

      await fs.promises.writeFile(
        fileA,
        '2026-01-01   open    Assets:Cash   USD\n',
        'utf8',
      );
      await fs.promises.writeFile(
        fileB,
        '2026-01-01 open Expenses:Food USD\n',
        'utf8',
      );

      // 1. --check fails and lists only unformatted a.ledger
      const { io } = makeIo({ cwd: dir });
      const checkBefore = await runFmt(
        makeArgs({ files: ['a.ledger', 'b.ledger'], check: true }),
        io,
      );
      assert(E.isLeft(checkBefore));
      assert(checkBefore.left.message.includes('a.ledger'));
      assert(!checkBefore.left.message.includes('b.ledger'));

      // 2. --write formats a.ledger in place
      const writeRes = await runFmt(
        makeArgs({ files: ['a.ledger', 'b.ledger'], write: true }),
        io,
      );
      assert(E.isRight(writeRes));
      assert.equal(
        await fs.promises.readFile(fileA, 'utf8'),
        '2026-01-01 open Assets:Cash USD\n',
      );

      // 3. --check now succeeds on both files
      const checkAfter = await runFmt(
        makeArgs({ files: ['a.ledger', 'b.ledger'], check: true }),
        io,
      );
      assert(E.isRight(checkAfter));
    });
  });

  await test('rejects invalid flag combinations, invalid configs, and syntax errors cleanly', async () => {
    const { io } = makeIo({ stdin: '' });

    const bothFlags = await runFmt(makeArgs({ write: true, check: true }), io);
    assert(E.isLeft(bothFlags));

    const writeStdin = await runFmt(makeArgs({ write: true }), io);
    assert(E.isLeft(writeStdin));

    const mixedStdin = await runFmt(
      makeArgs({ files: ['-', 'foo.ledger'], check: true }),
      io,
    );
    assert(E.isLeft(mixedStdin));

    const multiStdout = await runFmt(
      makeArgs({ files: ['a.ledger', 'b.ledger'] }),
      io,
    );
    assert(E.isLeft(multiStdout));

    const badSyntaxIo = makeIo({ stdin: '2026-01-01 bogus\n' });
    const badSyntax = await runFmt(
      makeArgs({ stdinFilepath: 'broken.ledger' }),
      badSyntaxIo.io,
    );
    assert(E.isLeft(badSyntax));
    assert(badSyntax.left.message.includes('broken.ledger:1:'));

    await withTempDir(async dir => {
      const badConfig = path.join(dir, 'bad.json');
      await fs.promises.writeFile(badConfig, '{"notAnOption": 1}', 'utf8');
      const dirIo = makeIo({ cwd: dir, stdin: '' });
      const badCfgRes = await runFmt(makeArgs({ config: badConfig }), dirIo.io);
      assert(E.isLeft(badCfgRes));
      assert(badCfgRes.left.message.includes('notAnOption'));
    });
  });
});
