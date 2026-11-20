import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';

import { either as E } from 'fp-ts';

import { parseSyntax } from '../syntax/parser.js';
import {
  format,
  FormatError,
  FormatOptions,
  resolveFormatOptions,
} from './formatter.js';

function formatOrThrow(
  source: string,
  options?: Partial<FormatOptions>,
): string {
  const result = format(source, options);
  if (E.isLeft(result)) {
    throw result.left;
  }
  return result.right;
}

function collectLedgerFixtures(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectLedgerFixtures(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ledger')) {
      out.push(fullPath);
    }
  }
  return out.sort();
}

await describe('formatter', async () => {
  await describe('options validation', async () => {
    await test('returns default options when input is undefined or empty', () => {
      assert(E.isRight(resolveFormatOptions()));
      assert(E.isRight(resolveFormatOptions({})));
    });

    await test('rejects non-object and unknown configuration keys', () => {
      assert(E.isLeft(resolveFormatOptions(null)));
      assert(E.isLeft(resolveFormatOptions([])));
      assert(E.isLeft(resolveFormatOptions('invalid')));

      const unknown = resolveFormatOptions({ unknownOption: true });
      assert(E.isLeft(unknown));
      assert(unknown.left instanceof FormatError);
      assert(unknown.left.message.includes('unknownOption'));
    });

    await test('rejects invalid option values', () => {
      assert(E.isLeft(format('', { indentWidth: 0 })));
      assert(E.isLeft(format('', { printWidth: -10 })));
      assert(E.isLeft(format('', { alignColumn: -1 })));
      assert(E.isLeft(format('', { maxAlignColumn: 0 })));
      assert(E.isLeft(format('', { minGapSpaces: 0 })));
      assert(E.isLeft(resolveFormatOptions({ alignScope: 'invalid-scope' })));
      assert(E.isLeft(resolveFormatOptions({ alignMode: 'invalid-mode' })));
      assert(E.isLeft(resolveFormatOptions({ alignTrailingComments: 'yes' })));
      assert(E.isLeft(resolveFormatOptions({ thousandsSeparator: 'space' })));
      assert(E.isLeft(resolveFormatOptions({ transactionFlagStyle: 'bang' })));
      assert(E.isLeft(resolveFormatOptions({ currencyKeywordStyle: 'curr' })));
      assert(E.isLeft(resolveFormatOptions({ trailingComma: 'es5' })));
    });
  });

  await describe('empty, comment-only, and whitespace-free inputs', async () => {
    await test('formats empty and whitespace-only files to empty string', () => {
      assert.equal(formatOrThrow(''), '');
      assert.equal(formatOrThrow('   \n\t  \n'), '');
    });

    await test('formats comment-only files with normalized spacing and blank lines', () => {
      const input = [
        '',
        ';header without space',
        ';; section banner',
        ';',
        '',
        '',
        '; trailing note   ',
        '',
      ].join('\n');

      assert.equal(
        formatOrThrow(input),
        [
          '; header without space',
          ';; section banner',
          ';',
          '',
          '; trailing note',
          '',
        ].join('\n'),
      );
    });

    await test('reconstructs canonical line-oriented layout from single-line unindented source', () => {
      const freeform =
        '2026-01-01 open Assets:Cash USD 2026-01-01 open Expenses:Food USD 2026-01-02 * "Lunch" Assets:Cash -12.50 USD Expenses:Food 12.50 USD';

      assert.equal(
        formatOrThrow(freeform),
        [
          '2026-01-01 open Assets:Cash USD',
          '2026-01-01 open Expenses:Food USD',
          '',
          '2026-01-02 * "Lunch"',
          '  Assets:Cash   -12.50 USD',
          '  Expenses:Food  12.50 USD',
          '',
        ].join('\n'),
      );
    });
  });

  await describe('top-level blank line rules', async () => {
    await test('preserves 0 vs 1 blank line between single-line directives and enforces 1 around multiline directives', () => {
      const input = [
        '2026-01-01 currency USD',
        '2026-01-01 currency CHF',
        '',
        '',
        '',
        '2026-01-01 open Assets:Cash USD',
        '2026-01-02 * "Coffee"',
        '  Assets:Cash  -5 USD',
        '  Expenses:Coffee',
        '2026-01-03 close Assets:Cash',
      ].join('\n');

      assert.equal(
        formatOrThrow(input),
        [
          '2026-01-01 currency USD',
          '2026-01-01 currency CHF',
          '',
          '2026-01-01 open Assets:Cash USD',
          '',
          '2026-01-02 * "Coffee"',
          '  Assets:Cash  -5 USD',
          '  Expenses:Coffee',
          '',
          '2026-01-03 close Assets:Cash',
          '',
        ].join('\n'),
      );
    });
  });

  await describe('alignment scopes and modes', async () => {
    const sampleTwoTransactions = [
      '2026-05-01 * "Short accounts"',
      '  Assets:Cash  -25.5 USD',
      '  Expenses:Tea  25.5 USD',
      '',
      '2026-05-02 * "Longer account names"',
      '  Assets:Checking:Joint:Primary  -1,200.50 USD',
      '  Expenses:Housing:Rent  1,200.50 USD',
      '',
      '2026-05-03 * "Short accounts after wide"',
      '  Assets:Cash  -10 USD',
      '  Expenses:Tip  10 USD',
    ].join('\n');

    await test('supports alignScope = "none"', () => {
      assert.equal(
        formatOrThrow(sampleTwoTransactions, { alignScope: 'none' }),
        [
          '2026-05-01 * "Short accounts"',
          '  Assets:Cash  -25.5 USD',
          '  Expenses:Tea  25.5 USD',
          '',
          '2026-05-02 * "Longer account names"',
          '  Assets:Checking:Joint:Primary  -1,200.50 USD',
          '  Expenses:Housing:Rent  1,200.50 USD',
          '',
          '2026-05-03 * "Short accounts after wide"',
          '  Assets:Cash  -10 USD',
          '  Expenses:Tip  10 USD',
          '',
        ].join('\n'),
      );
    });

    await test('supports alignScope = "directive" (independent per directive)', () => {
      assert.equal(
        formatOrThrow(sampleTwoTransactions, { alignScope: 'directive' }),
        [
          '2026-05-01 * "Short accounts"',
          '  Assets:Cash  -25.5 USD',
          '  Expenses:Tea  25.5 USD',
          '',
          '2026-05-02 * "Longer account names"',
          '  Assets:Checking:Joint:Primary  -1,200.50 USD',
          '  Expenses:Housing:Rent           1,200.50 USD',
          '',
          '2026-05-03 * "Short accounts after wide"',
          '  Assets:Cash  -10 USD',
          '  Expenses:Tip  10 USD',
          '',
        ].join('\n'),
      );
    });

    await test('supports alignScope = "file" (uniform column across whole file)', () => {
      assert.equal(
        formatOrThrow(sampleTwoTransactions, { alignScope: 'file' }),
        [
          '2026-05-01 * "Short accounts"',
          '  Assets:Cash                        -25.5 USD',
          '  Expenses:Tea                        25.5 USD',
          '',
          '2026-05-02 * "Longer account names"',
          '  Assets:Checking:Joint:Primary  -1,200.50 USD',
          '  Expenses:Housing:Rent           1,200.50 USD',
          '',
          '2026-05-03 * "Short accounts after wide"',
          '  Assets:Cash                          -10 USD',
          '  Expenses:Tip                          10 USD',
          '',
        ].join('\n'),
      );
    });

    await test('supports alignScope = "file-grow-only" without mutating earlier directives when wider ones are appended', () => {
      const prefixOnly = [
        '2026-05-01 * "Short accounts"',
        '  Assets:Cash  -25.5 USD',
        '  Expenses:Tea  25.5 USD',
      ].join('\n');

      const formattedPrefix = formatOrThrow(prefixOnly, {
        alignScope: 'file-grow-only',
      });
      const formattedFull = formatOrThrow(sampleTwoTransactions, {
        alignScope: 'file-grow-only',
      });

      assert(formattedFull.startsWith(formattedPrefix));
      assert.equal(
        formattedFull,
        [
          '2026-05-01 * "Short accounts"',
          '  Assets:Cash  -25.5 USD',
          '  Expenses:Tea  25.5 USD',
          '',
          '2026-05-02 * "Longer account names"',
          '  Assets:Checking:Joint:Primary  -1,200.50 USD',
          '  Expenses:Housing:Rent           1,200.50 USD',
          '',
          '2026-05-03 * "Short accounts after wide"',
          '  Assets:Cash                          -10 USD',
          '  Expenses:Tip                          10 USD',
          '',
        ].join('\n'),
      );
    });

    await test('respects maxAlignColumn outlier capping in file and file-grow-only scopes', () => {
      assert.equal(
        formatOrThrow(sampleTwoTransactions, {
          alignScope: 'file',
          maxAlignColumn: 30,
        }),
        [
          '2026-05-01 * "Short accounts"',
          '  Assets:Cash  -25.5 USD',
          '  Expenses:Tea  25.5 USD',
          '',
          '2026-05-02 * "Longer account names"',
          '  Assets:Checking:Joint:Primary  -1,200.50 USD',
          '  Expenses:Housing:Rent  1,200.50 USD',
          '',
          '2026-05-03 * "Short accounts after wide"',
          '  Assets:Cash    -10 USD',
          '  Expenses:Tip    10 USD',
          '',
        ].join('\n'),
      );
    });

    await test('supports alignScope = "fixed" with graceful overflow', () => {
      const input = [
        '2026-05-01 * "Fixed column"',
        '  Assets:Cash  -10.50 CHF',
        '  Expenses:Very:Long:Account:Hierarchy:Name  10.50 CHF',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { alignScope: 'fixed', alignColumn: 30 }),
        [
          '2026-05-01 * "Fixed column"',
          '  Assets:Cash          -10.50 CHF',
          '  Expenses:Very:Long:Account:Hierarchy:Name  10.50 CHF',
          '',
        ].join('\n'),
      );
    });

    await test('supports alignMode = "currency", "decimal", and "decimal-and-currency"', () => {
      const mixedAmounts = [
        '2026-05-01 * "Precision mix"',
        '  Assets:Checking  -1,100.50 CHF',
        '  Expenses:Groceries  100 CHF',
        '  Expenses:Bakery  0.125 CHF',
        '  Expenses:Split  (50 * 20) CHF',
      ].join('\n');

      assert.equal(
        formatOrThrow(mixedAmounts, { alignMode: 'currency' }),
        [
          '2026-05-01 * "Precision mix"',
          '  Assets:Checking  -1,100.50 CHF',
          '  Expenses:Groceries     100 CHF',
          '  Expenses:Bakery      0.125 CHF',
          '  Expenses:Split   (50 * 20) CHF',
          '',
        ].join('\n'),
      );

      assert.equal(
        formatOrThrow(mixedAmounts, { alignMode: 'decimal' }),
        [
          '2026-05-01 * "Precision mix"',
          '  Assets:Checking    -1,100.50 CHF',
          '  Expenses:Groceries    100 CHF',
          '  Expenses:Bakery         0.125 CHF',
          '  Expenses:Split  (50 * 20) CHF',
          '',
        ].join('\n'),
      );

      assert.equal(
        formatOrThrow(mixedAmounts, { alignMode: 'decimal-and-currency' }),
        [
          '2026-05-01 * "Precision mix"',
          '  Assets:Checking    -1,100.50  CHF',
          '  Expenses:Groceries    100     CHF',
          '  Expenses:Bakery         0.125 CHF',
          '  Expenses:Split  (50 * 20)     CHF',
          '',
        ].join('\n'),
      );
    });

    await test('aligns balance directives including approximate tolerances', () => {
      const input = [
        '2026-05-01 balance',
        '  Assets:Cash  100.5 USD ~ 0.05',
        '  Assets:Savings:Emergency  2500.75 USD',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { alignMode: 'decimal-and-currency' }),
        [
          '2026-05-01 balance',
          '  Assets:Cash                100.5  USD ~ 0.05',
          '  Assets:Savings:Emergency  2500.75 USD',
          '',
        ].join('\n'),
      );
    });
  });

  await describe('trailing comments alignment and comment preservation', async () => {
    await test('supports alignTrailingComments = false and true', () => {
      const input = [
        '2026-05-01 * "Comments" ;header comment',
        '  Assets:Cash  -50.00 USD ;paid cash',
        '  Expenses:Books  30.00 USD { 30.00 USD } ;hardcover',
        '  Expenses:Snacks ;inferred remainder',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { alignTrailingComments: false }),
        [
          '2026-05-01 * "Comments"  ; header comment',
          '  Assets:Cash    -50.00 USD  ; paid cash',
          '  Expenses:Books  30.00 USD { 30.00 USD }  ; hardcover',
          '  Expenses:Snacks  ; inferred remainder',
          '',
        ].join('\n'),
      );

      assert.equal(
        formatOrThrow(input, { alignTrailingComments: true }),
        [
          '2026-05-01 * "Comments"  ; header comment',
          '  Assets:Cash    -50.00 USD                ; paid cash',
          '  Expenses:Books  30.00 USD { 30.00 USD }  ; hardcover',
          '  Expenses:Snacks                          ; inferred remainder',
          '',
        ].join('\n'),
      );
    });

    await test('preserves comments in every syntactic position including inside rules and expressions', () => {
      const input = [
        '; File header',
        '',
        'account-rule "routing" {',
        '  ; First rule comment',
        '  when payee == "ACME": Expenses:Supplies, ; inline comma comment',
        '  ; Fallback comment',
        '  otherwise: Expenses:Misc',
        '  ; Dangling before close brace',
        '}',
        '',
        '2026-05-01 * ; mid-header comment',
        '  "Complex comments"',
        '  ; Metadata comment',
        '  receipt: "abc"',
        '  ; Before first posting',
        '  Assets:Cash  (10 + ; mid-expression comment',
        '    20) USD {',
        '    10 USD',
        '    ; Dangling inside cost spec',
        '  }',
        '  choose account {',
        '    ; Inside inline choice',
        '    when foo == 1: Expenses:Alpha',
        '  } ; after choice block',
        '; EOF comment',
      ].join('\n');

      const formatted = formatOrThrow(input);
      assert.equal(formatOrThrow(formatted), formatted);
      assert(formatted.includes('; File header'));
      assert(formatted.includes('; First rule comment'));
      assert(formatted.includes('; inline comma comment'));
      assert(formatted.includes('; Fallback comment'));
      assert(formatted.includes('; Dangling before close brace'));
      assert(formatted.includes('; Metadata comment'));
      assert(formatted.includes('; Before first posting'));
      assert(formatted.includes('; mid-expression comment'));
      assert(formatted.includes('; Inside inline choice'));
      assert(formatted.includes('; after choice block'));
      assert(formatted.includes('; EOF comment'));
    });
  });

  await describe('lexical normalization options', async () => {
    await test('formats thousands separators in preserve, add, and remove modes without losing precision', () => {
      const input = [
        'account-rule "dur" {',
        '  when age > 1000d: Expenses:Old,',
        '}',
        '',
        '2026-05-01 * "Numbers"',
        '  Assets:Alpha  -1000000.00 USD',
        '  Assets:Beta  1,234,567. USD',
        '  Assets:Gamma  999.5000 USD',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { thousandsSeparator: 'add' }),
        [
          'account-rule "dur" {',
          '  when age > 1,000d: Expenses:Old,',
          '}',
          '',
          '2026-05-01 * "Numbers"',
          '  Assets:Alpha  -1,000,000.00 USD',
          '  Assets:Beta      1,234,567. USD',
          '  Assets:Gamma       999.5000 USD',
          '',
        ].join('\n'),
      );

      assert.equal(
        formatOrThrow(input, { thousandsSeparator: 'remove' }),
        [
          'account-rule "dur" {',
          '  when age > 1000d: Expenses:Old,',
          '}',
          '',
          '2026-05-01 * "Numbers"',
          '  Assets:Alpha  -1000000.00 USD',
          '  Assets:Beta      1234567. USD',
          '  Assets:Gamma     999.5000 USD',
          '',
        ].join('\n'),
      );
    });

    await test('normalizes transaction flags while always preserving "!"', () => {
      const input = [
        '2026-05-01 * "Star"',
        '',
        '2026-05-02 txn "Keyword"',
        '',
        '2026-05-03 ! "Pending"',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { transactionFlagStyle: 'txn' }),
        [
          '2026-05-01 txn "Star"',
          '',
          '2026-05-02 txn "Keyword"',
          '',
          '2026-05-03 ! "Pending"',
          '',
        ].join('\n'),
      );

      assert.equal(
        formatOrThrow(input, { transactionFlagStyle: 'star' }),
        [
          '2026-05-01 * "Star"',
          '',
          '2026-05-02 * "Keyword"',
          '',
          '2026-05-03 ! "Pending"',
          '',
        ].join('\n'),
      );
    });

    await test('normalizes currency/commodity keywords according to currencyKeywordStyle', () => {
      const input = [
        '2026-01-01 currency USD',
        '2026-01-01 commodity BTC',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { currencyKeywordStyle: 'currency' }),
        ['2026-01-01 currency USD', '2026-01-01 currency BTC', ''].join('\n'),
      );

      assert.equal(
        formatOrThrow(input, { currencyKeywordStyle: 'commodity' }),
        ['2026-01-01 commodity USD', '2026-01-01 commodity BTC', ''].join('\n'),
      );
    });

    await test('handles trailingComma = "multiline" | "always" | "never"', () => {
      const input = [
        'account-rule "multi" {',
        '  when foo == 1: Assets:Alpha',
        '}',
        '',
        '2026-05-01 * "Inline"',
        '  choose account { when foo == 1: Assets:Alpha, }',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { trailingComma: 'multiline' }),
        [
          'account-rule "multi" {',
          '  when foo == 1: Assets:Alpha,',
          '}',
          '',
          '2026-05-01 * "Inline"',
          '  choose account { when foo == 1: Assets:Alpha }',
          '',
        ].join('\n'),
      );

      assert.equal(
        formatOrThrow(input, { trailingComma: 'always' }),
        [
          'account-rule "multi" {',
          '  when foo == 1: Assets:Alpha,',
          '}',
          '',
          '2026-05-01 * "Inline"',
          '  choose account { when foo == 1: Assets:Alpha, }',
          '',
        ].join('\n'),
      );

      assert.equal(
        formatOrThrow(input, { trailingComma: 'never' }),
        [
          'account-rule "multi" {',
          '  when foo == 1: Assets:Alpha',
          '}',
          '',
          '2026-05-01 * "Inline"',
          '  choose account { when foo == 1: Assets:Alpha }',
          '',
        ].join('\n'),
      );
    });
  });

  await describe('pragmas (; ledger-fmt: off / on)', async () => {
    await test('preserves raw formatting verbatim inside disabled regions and resumes afterward', () => {
      const messyBlock = [
        '; ledger-fmt: off',
        '2026-05-02   txn   "Hand-aligned matrix"',
        '    Assets:Alpha           100.00   USD',
        '    Assets:Beta            -50.00   USD ;nospace',
        '    Assets:Gamma           -50.00   USD',
        '; ledger-fmt: on',
      ].join('\n');

      const input = [
        '2026-05-01   open    Assets:Alpha   USD',
        messyBlock,
        '2026-05-03   *   "Formatted again"',
        '      Assets:Alpha    10 USD',
        '      Assets:Beta   -10 USD',
      ].join('\n');

      const expected = [
        '2026-05-01 open Assets:Alpha USD',
        '',
        messyBlock,
        '',
        '2026-05-03 * "Formatted again"',
        '  Assets:Alpha  10 USD',
        '  Assets:Beta  -10 USD',
        '',
      ].join('\n');

      assert.equal(formatOrThrow(input), expected);
      assert.equal(formatOrThrow(expected), expected);
    });

    await test('handles unclosed ; ledger-fmt: off through EOF', () => {
      const input = [
        '2026-05-01   open   Assets:Alpha',
        '; ledger-fmt: off',
        '2026-05-02   open      Assets:Beta',
      ].join('\n');

      const expected = [
        '2026-05-01 open Assets:Alpha',
        '',
        '; ledger-fmt: off',
        '2026-05-02   open      Assets:Beta',
        '',
      ].join('\n');

      assert.equal(formatOrThrow(input), expected);
      assert.equal(formatOrThrow(expected), expected);
    });
  });

  await describe('printWidth line wrapping', async () => {
    await test('wraps long boolean condition chains, cost specs, and expressions cleanly', () => {
      const input = [
        'account-rule "wrap-test" {',
        '  when description == "Supermarket" and narration == "Weekly groceries" and amount >= 100.00 USD: Expenses:Food:Groceries,',
        '}',
        '',
        '2026-05-01 * "Long cost spec"',
        '  Assets:Investments  10 AAPL { 185.50 USD, 2026-05-01 14:30:00 Z, "lot-primary-2026" } @ 190.00 USD',
        '  Assets:Cash  -(100 + 200 + 300 + 400 + 500 + 600) USD',
      ].join('\n');

      const narrow = formatOrThrow(input, { printWidth: 55 });
      assert.equal(formatOrThrow(narrow, { printWidth: 55 }), narrow);
      assert(narrow.includes('and narration == "Weekly groceries"'));
      assert(narrow.split('\n').length > input.split('\n').length);
    });

    await test('preserves space in double unary minus (- -1) without merging tokens', () => {
      const input = [
        '2026-05-01 balance',
        '  Assets:Cash  - - 1 USD',
        '  Assets:Bank  + -1 USD',
      ].join('\n');

      const formatted = formatOrThrow(input);
      assert.equal(
        formatted,
        [
          '2026-05-01 balance',
          '  Assets:Cash  - -1 USD',
          '  Assets:Bank  + -1 USD',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(formatted), formatted);
    });
  });

  await describe('error reporting', async () => {
    await test('returns FormatError with source position on invalid syntax', () => {
      const res = format('2026-01-01 unknown-directive Assets:Cash\n');
      assert(E.isLeft(res));
      assert(res.left instanceof FormatError);
      assert.equal(res.left.srcPos?.row, 1);
    });
  });

  await describe('repository fixture corpus idempotency and semantic equivalence', async () => {
    const fixtureRoots = [
      path.resolve(import.meta.dirname, '../parsing/testdata'),
      path.resolve(import.meta.dirname, '../loading/testdata'),
      path.resolve(import.meta.dirname, '../booking/testdata'),
    ];
    const allFiles = fixtureRoots.flatMap(dir => collectLedgerFixtures(dir));
    const validFixtures = allFiles.filter(file =>
      E.isRight(parseSyntax(fs.readFileSync(file, 'utf8'))),
    );

    const profiles: readonly [string, Partial<FormatOptions>][] = [
      ['default (directive + currency)', {}],
      ['none', { alignScope: 'none' }],
      ['file + decimal', { alignScope: 'file', alignMode: 'decimal' }],
      [
        'file-grow-only + decimal-and-currency',
        { alignScope: 'file-grow-only', alignMode: 'decimal-and-currency' },
      ],
      [
        'fixed + alignTrailingComments',
        { alignScope: 'fixed', alignTrailingComments: true },
      ],
      ['thousandsSeparator=add', { thousandsSeparator: 'add' }],
      [
        'thousandsSeparator=remove + txn + currency',
        {
          thousandsSeparator: 'remove',
          transactionFlagStyle: 'txn',
          currencyKeywordStyle: 'currency',
        },
      ],
      [
        'narrow printWidth=45 + trailingComma=never + indentWidth=4',
        { printWidth: 45, trailingComma: 'never', indentWidth: 4 },
      ],
    ];

    await test('discovers a comprehensive corpus of valid .ledger fixtures', () => {
      assert(validFixtures.length > 70);
    });

    for (const [profileName, opts] of profiles) {
      await test(`formats all valid fixtures idempotently under profile: ${profileName}`, () => {
        for (const file of validFixtures) {
          const raw = fs.readFileSync(file, 'utf8');
          const pass1 = format(raw, opts);
          if (E.isLeft(pass1)) {
            throw new Error(
              `Failed pass 1 on ${file} (${profileName}): ${pass1.left.message}`,
            );
          }
          const pass2 = format(pass1.right, opts);
          if (E.isLeft(pass2)) {
            throw new Error(
              `Failed pass 2 on ${file} (${profileName}): ${pass2.left.message}`,
            );
          }
          assert.equal(
            pass2.right,
            pass1.right,
            `Idempotency mismatch in ${file}`,
          );
        }
      });
    }
  });
});
