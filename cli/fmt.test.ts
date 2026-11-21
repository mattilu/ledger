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
      '--cost-spec-wrap-style',
      'expanded',
      'a.ledger',
      'b.ledger',
    ]);
    assert.equal(parsed._tag, 'ok');
    assert.equal(parsed.value.args.costSpecWrapStyle, 'expanded');

    const parsedExplicitFalse = await parse(app, [
      'fmt',
      '--align-trailing-comments=false',
      '--max-align-column',
      'none',
      'a.ledger',
    ]);
    assert.equal(parsedExplicitFalse._tag, 'ok');
    assert.equal(parsedExplicitFalse.value.args.alignTrailingComments, false);
    assert.equal(parsedExplicitFalse.value.args.maxAlignColumn, null);

    const parsedOmitted = await parse(app, ['fmt', 'a.ledger']);
    assert.equal(parsedOmitted._tag, 'ok');
    assert.equal(parsedOmitted.value.args.alignTrailingComments, undefined);
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

  await test('writes formatted files atomically preserving file mode', async () => {
    await withTempDir(async dir => {
      const target = path.join(dir, 'target.ledger');
      const unformatted = '2026-01-01   open    Assets:Cash   USD\n';

      await fs.promises.writeFile(target, unformatted, {
        encoding: 'utf8',
        mode: 0o600,
      });

      const { io } = makeIo({ cwd: dir });
      const res = await runFmt(
        makeArgs({ files: ['target.ledger'], write: true }),
        io,
      );
      assert(E.isRight(res));
      assert.equal(
        await fs.promises.readFile(target, 'utf8'),
        '2026-01-01 open Assets:Cash USD\n',
      );
      const statAfter = await fs.promises.stat(target);
      assert.equal(statAfter.mode & 0o777, 0o600);
      // No leftover temporary files in directory.
      const entries = (await fs.promises.readdir(dir)).sort();
      assert.deepEqual(entries, ['target.ledger']);
    });
  });

  await test('stops config discovery at VCS root', async () => {
    await withTempDir(async outer => {
      await fs.promises.writeFile(
        path.join(outer, CONFIG_FILENAME),
        JSON.stringify({ indentWidth: 4 }),
        'utf8',
      );

      const repoRoot = path.join(outer, 'repo');
      const subDir = path.join(repoRoot, 'books');
      await fs.promises.mkdir(path.join(repoRoot, '.git'), { recursive: true });
      await fs.promises.mkdir(subDir, { recursive: true });

      // Must stop at repo/.git and not inherit outer/.ledgerfmt.json.
      assert.equal(discoverConfigPath(subDir), null);
    });
  });

  await test('sanitizes terminal escape sequences in format and check diagnostics', async () => {
    const badMaxAlign = await parse(app, [
      'fmt',
      '--max-align-column',
      '\x1b[31mbad',
      'a.ledger',
    ]);
    assert.equal(badMaxAlign._tag, 'error');
    const badMaxAlignMsg = badMaxAlign.error.errors[0].message;
    assert(!badMaxAlignMsg.includes('\x1b'));
    assert(badMaxAlignMsg.includes('\\x1b[31mbad'));

    const newlinePathIo = makeIo({
      stdin: '2026-01-01   open   Assets:Cash\n',
    });
    const newlinePathRes = await runFmt(
      makeArgs({ check: true, stdinFilepath: 'a.ledger\n  forged.ledger' }),
      newlinePathIo.io,
    );
    assert(E.isLeft(newlinePathRes));
    assert(
      newlinePathRes.left.message.includes('a.ledger\\x0a  forged.ledger'),
    );
    const { io } = makeIo({ stdin: 'option \x1b[31mbad\n' });
    const res = await runFmt(
      makeArgs({ stdinFilepath: '\x1b[2Jevil.ledger' }),
      io,
    );
    assert(E.isLeft(res));
    assert(!res.left.message.includes('\x1b'));
    assert(res.left.message.includes('\\x1b[2Jevil.ledger'));

    const checkIo = makeIo({ stdin: '2026-01-01   open   Assets:Cash\n' });
    const checkRes = await runFmt(
      makeArgs({ check: true, stdinFilepath: '\x1b[31munformatted.ledger' }),
      checkIo.io,
    );
    assert(E.isLeft(checkRes));
    assert(!checkRes.left.message.includes('\x1b'));
    assert(checkRes.left.message.includes('\\x1b[31munformatted.ledger'));

    const stdinErrRes = await runFmt(makeArgs(), {
      cwd: () => process.cwd(),
      readStdin: async () => {
        throw new Error('\x1b[31mboom');
      },
      writeStdout: () => {},
    });
    assert(E.isLeft(stdinErrRes));
    assert(!stdinErrRes.left.message.includes('\x1b'));
    assert(stdinErrRes.left.message.includes('\\x1b[31mboom'));
  });

  await test('does not modify earlier files in --write mode if a later file fails to format', async () => {
    await withTempDir(async dir => {
      const validFile = path.join(dir, 'a.ledger');
      const brokenFile = path.join(dir, 'b.ledger');
      const originalValid = '2026-01-01   open    Assets:Cash   USD\n';

      await fs.promises.writeFile(validFile, originalValid, 'utf8');
      await fs.promises.writeFile(brokenFile, '2026-01-01 bogus\n', 'utf8');

      const { io } = makeIo({ cwd: dir });
      const res = await runFmt(
        makeArgs({ files: ['a.ledger', 'b.ledger'], write: true }),
        io,
      );
      assert(E.isLeft(res));
      assert.equal(
        await fs.promises.readFile(validFile, 'utf8'),
        originalValid,
      );
    });
  });

  await test('allows clearing maxAlignColumn from .ledgerfmt.json via CLI override', async () => {
    await withTempDir(async dir => {
      await fs.promises.writeFile(
        path.join(dir, CONFIG_FILENAME),
        JSON.stringify({ alignScope: 'file', maxAlignColumn: 20 }),
        'utf8',
      );
      const input = [
        '2026-05-01 * "Short"',
        '  Assets:Cash  -10 USD',
        '',
        '2026-05-02 * "Wide"',
        '  Assets:Checking:Joint:Primary  -100 USD',
        '',
      ].join('\n');

      const { io, getStdout } = makeIo({ cwd: dir, stdin: input });
      const res = await runFmt(makeArgs({ maxAlignColumn: null }), io);
      assert(E.isRight(res));
      assert.equal(
        getStdout(),
        [
          '2026-05-01 * "Short"',
          '  Assets:Cash                     -10 USD',
          '',
          '2026-05-02 * "Wide"',
          '  Assets:Checking:Joint:Primary  -100 USD',
          '',
        ].join('\n'),
      );
    });
  });

  await test('rejects non-UTF-8 files without corrupting them in --write mode', async () => {
    await withTempDir(async dir => {
      const target = path.join(dir, 'latin1.ledger');
      const rawBytes = Buffer.from([
        ...Buffer.from('2026-05-01   *   "Caf'),
        0xe9,
        ...Buffer.from('"\n  Assets:Cash  10 USD\n  Expenses:Food  -10 USD\n'),
      ]);
      await fs.promises.writeFile(target, rawBytes);

      const { io } = makeIo({ cwd: dir });
      const res = await runFmt(
        makeArgs({ files: ['latin1.ledger'], write: true }),
        io,
      );
      assert(E.isLeft(res));
      assert.match(res.left.message, /Invalid UTF-8/);
      assert.deepEqual(await fs.promises.readFile(target), rawBytes);
    });
  });

  await test('rejects malformed numeric CLI flags and conflicting or empty --stdin-filepath', async () => {
    const trailingGarbage = await parse(app, [
      'fmt',
      '--indent-width',
      '4px',
      'a.ledger',
    ]);
    assert.equal(trailingGarbage._tag, 'error');

    const hexMaxAlign = await parse(app, [
      'fmt',
      '--max-align-column',
      '0x20',
      'a.ledger',
    ]);
    assert.equal(hexMaxAlign._tag, 'error');

    const { io } = makeIo({ stdin: '' });
    const emptyStdinPath = await runFmt(makeArgs({ stdinFilepath: '' }), io);
    assert(E.isLeft(emptyStdinPath));

    const stdinWithFiles = await runFmt(
      makeArgs({ files: ['a.ledger'], stdinFilepath: 'other.ledger' }),
      io,
    );
    assert(E.isLeft(stdinWithFiles));

    // --stdin-filepath "." should search cwd rather than its parent.
    await withTempDir(async root => {
      const sub = path.join(root, 'sub');
      await fs.promises.mkdir(sub);
      await fs.promises.writeFile(
        path.join(sub, CONFIG_FILENAME),
        JSON.stringify({ indentWidth: 4 }),
        'utf8',
      );
      const subIo = makeIo({
        cwd: sub,
        stdin: '2026-05-01 * "t"\n  Assets:Cash  10 USD\n',
      });
      const res = await runFmt(makeArgs({ stdinFilepath: '.' }), subIo.io);
      assert(E.isRight(res));
      assert.equal(
        subIo.getStdout(),
        '2026-05-01 * "t"\n    Assets:Cash  10 USD\n',
      );
    });
  });

  await test('reports broken .ledgerfmt.json symlinks instead of inheriting parent configs', async () => {
    await withTempDir(async outer => {
      await fs.promises.writeFile(
        path.join(outer, CONFIG_FILENAME),
        JSON.stringify({ indentWidth: 4 }),
        'utf8',
      );
      const inner = path.join(outer, 'inner');
      await fs.promises.mkdir(inner);
      await fs.promises.symlink(
        path.join(inner, 'missing.json'),
        path.join(inner, CONFIG_FILENAME),
      );

      assert.equal(
        discoverConfigPath(inner),
        path.join(inner, CONFIG_FILENAME),
      );
      const { io } = makeIo({ cwd: inner, stdin: '' });
      const res = await runFmt(makeArgs(), io);
      assert(E.isLeft(res));
      assert.match(res.left.message, /Failed to read formatter config/);
    });
  });

  await test('stops config discovery at unreadable directories instead of climbing past them', async () => {
    if (process.getuid?.() === 0) {
      return;
    }
    await withTempDir(async outer => {
      await fs.promises.writeFile(
        path.join(outer, CONFIG_FILENAME),
        JSON.stringify({ indentWidth: 4 }),
        'utf8',
      );
      const locked = path.join(outer, 'locked');
      await fs.promises.mkdir(locked);
      await fs.promises.chmod(locked, 0o000);
      try {
        assert.equal(discoverConfigPath(locked), null);
      } finally {
        await fs.promises.chmod(locked, 0o700);
      }
    });
  });

  await test('allows overriding alignScope to fixed over a config with maxAlignColumn', async () => {
    await withTempDir(async dir => {
      await fs.promises.writeFile(
        path.join(dir, CONFIG_FILENAME),
        JSON.stringify({ alignScope: 'file', maxAlignColumn: 40 }),
        'utf8',
      );
      const { io, getStdout } = makeIo({
        cwd: dir,
        stdin: '2026-05-01 * "t"\n  Assets:Cash  10 USD\n',
      });
      const res = await runFmt(
        makeArgs({ alignScope: 'fixed', alignColumn: 52 }),
        io,
      );
      assert(E.isRight(res));
      assert(getStdout().includes('10 USD'));
    });
  });

  await test('deduplicates repeated file arguments and preserves symlinks on --write', async () => {
    await withTempDir(async dir => {
      const target = path.join(dir, 'real.ledger');
      const link = path.join(dir, 'link.ledger');
      await fs.promises.writeFile(
        target,
        '2026-01-01   open   Assets:Cash   USD\n',
        'utf8',
      );
      await fs.promises.symlink(target, link);

      const { io } = makeIo({ cwd: dir });
      const checkRes = await runFmt(
        makeArgs({
          files: ['real.ledger', './real.ledger', 'link.ledger'],
          check: true,
        }),
        io,
      );
      assert(E.isLeft(checkRes));
      assert.equal(checkRes.left.message.split('\n').length, 2);

      const writeRes = await runFmt(
        makeArgs({ files: ['link.ledger'], write: true }),
        io,
      );
      assert(E.isRight(writeRes));
      assert((await fs.promises.lstat(link)).isSymbolicLink());
      assert.equal(
        await fs.promises.readFile(target, 'utf8'),
        '2026-01-01 open Assets:Cash USD\n',
      );
    });
  });

  await test('reports directory .ledgerfmt.json entries instead of inheriting parent configs', async () => {
    await withTempDir(async outer => {
      await fs.promises.writeFile(
        path.join(outer, CONFIG_FILENAME),
        JSON.stringify({ indentWidth: 4 }),
        'utf8',
      );
      const inner = path.join(outer, 'inner');
      await fs.promises.mkdir(path.join(inner, CONFIG_FILENAME), {
        recursive: true,
      });

      assert.equal(
        discoverConfigPath(inner),
        path.join(inner, CONFIG_FILENAME),
      );
      const { io } = makeIo({ cwd: inner, stdin: '' });
      const res = await runFmt(makeArgs(), io);
      assert(E.isLeft(res));
      assert.match(res.left.message, /Failed to read formatter config/);
    });
  });

  await test('treats UTF-8 BOM consistently across --check and --write', async () => {
    await withTempDir(async dir => {
      const target = path.join(dir, 'bom.ledger');
      const body = '2026-01-01 open Assets:Cash\n';
      await fs.promises.writeFile(
        target,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body)]),
      );

      const { io } = makeIo({ cwd: dir });
      const checkBefore = await runFmt(
        makeArgs({ files: ['bom.ledger'], check: true }),
        io,
      );
      assert(E.isLeft(checkBefore));

      const writeRes = await runFmt(
        makeArgs({ files: ['bom.ledger'], write: true }),
        io,
      );
      assert(E.isRight(writeRes));
      assert.deepEqual(
        await fs.promises.readFile(target),
        Buffer.from(body, 'utf8'),
      );

      const checkAfter = await runFmt(
        makeArgs({ files: ['bom.ledger'], check: true }),
        io,
      );
      assert(E.isRight(checkAfter));
    });
  });

  await test('loads .ledgerfmt.json with a UTF-8 BOM and preserves alignTrailingComments when CLI flag is omitted', async () => {
    await withTempDir(async dir => {
      const cfgBytes = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from(JSON.stringify({ alignTrailingComments: true }), 'utf8'),
      ]);
      await fs.promises.writeFile(path.join(dir, CONFIG_FILENAME), cfgBytes);

      const input = [
        '2026-05-01 * "Comments"',
        '  Assets:Cash  -10 USD ; short',
        '  Expenses:Groceries  10 USD { 10 USD } ; longer',
        '',
      ].join('\n');

      const parsed = await parse(app, ['fmt']);
      assert.equal(parsed._tag, 'ok');
      assert.equal(parsed.value.args.alignTrailingComments, undefined);

      const { io, getStdout } = makeIo({ cwd: dir, stdin: input });
      const res = await runFmt(parsed.value.args, io);
      assert(E.isRight(res));
      assert.equal(
        getStdout(),
        [
          '2026-05-01 * "Comments"',
          '  Assets:Cash        -10 USD             ; short',
          '  Expenses:Groceries  10 USD { 10 USD }  ; longer',
          '',
        ].join('\n'),
      );
    });
  });
});
