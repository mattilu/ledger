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
      assert(E.isLeft(format('', { indentWidth: 100 })));
      assert(E.isLeft(format('', { indentWidth: 1e9 })));
      assert(E.isLeft(format('', { printWidth: -10 })));
      assert(E.isLeft(format('', { printWidth: 100_000 })));
      assert(E.isLeft(format('', { alignColumn: -1 })));
      assert(E.isLeft(format('', { alignColumn: 10_000 })));
      assert(E.isLeft(format('', { maxAlignColumn: 0 })));
      assert(E.isLeft(format('', { maxAlignColumn: 10_000 })));
      assert(
        E.isLeft(
          format('', {
            alignScope: 'file',
            alignColumn: 50,
            maxAlignColumn: 30,
          }),
        ),
      );
      assert(
        E.isLeft(
          format('', {
            alignScope: 'file-grow-only',
            alignColumn: 50,
            maxAlignColumn: 30,
          }),
        ),
      );
      // maxAlignColumn is unused outside file / file-grow-only scopes.
      assert(
        E.isRight(
          format('', {
            alignScope: 'fixed',
            alignColumn: 52,
            maxAlignColumn: 40,
          }),
        ),
      );
      assert(E.isLeft(format('', { minGapSpaces: 0 })));
      assert(E.isLeft(format('', { minGapSpaces: 1_000 })));
      assert(E.isLeft(resolveFormatOptions({ alignScope: 'invalid-scope' })));
      assert(E.isLeft(resolveFormatOptions({ alignMode: 'invalid-mode' })));
      assert(E.isLeft(resolveFormatOptions({ alignTrailingComments: 'yes' })));
      assert(E.isLeft(resolveFormatOptions({ thousandsSeparator: 'space' })));
      assert(E.isLeft(resolveFormatOptions({ transactionFlagStyle: 'bang' })));
      assert(E.isLeft(resolveFormatOptions({ currencyKeywordStyle: 'curr' })));
      assert(E.isLeft(resolveFormatOptions({ trailingComma: 'es5' })));
      assert(E.isLeft(resolveFormatOptions({ costSpecWrapStyle: 'inline' })));
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

      // In decimal-and-currency mode, capped outliers are excluded from both
      // anchor and fractional width so non-outlier rows are not over-padded.
      const decimalOutlier = [
        '2026-05-01 * "Outlier precision"',
        '  Assets:Cash  10.50 USD',
        '  Expenses:Very:Long:Outlier:Account:Name  -10.12345 USD',
        '',
        '2026-05-02 * "Regular"',
        '  Assets:Cash  10 USD',
        '  Expenses:Food  -10.5 USD',
      ].join('\n');
      assert.equal(
        formatOrThrow(decimalOutlier, {
          alignScope: 'file-grow-only',
          alignMode: 'decimal-and-currency',
          maxAlignColumn: 30,
        }),
        [
          '2026-05-01 * "Outlier precision"',
          '  Assets:Cash  10.50 USD',
          '  Expenses:Very:Long:Outlier:Account:Name  -10.12345 USD',
          '',
          '2026-05-02 * "Regular"',
          '  Assets:Cash     10    USD',
          '  Expenses:Food  -10.5  USD',
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

    await test('supports alignColumn minimum floor in directive scope', () => {
      const input = [
        '2026-05-01 * "Floor"',
        '  Assets:Cash  10 USD',
        '  Expenses:Food  -10 USD',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, { alignScope: 'directive', alignColumn: 30 }),
        [
          '2026-05-01 * "Floor"',
          '  Assets:Cash              10 USD',
          '  Expenses:Food           -10 USD',
          '',
        ].join('\n'),
      );
    });

    await test('aligns both decimals and currencies across directives in fixed + decimal-and-currency mode', () => {
      const input = [
        '2026-05-01 * "Two decimals"',
        '  Assets:Cash  10.50 USD',
        '',
        '2026-05-02 * "Three decimals"',
        '  Assets:Cash  10.125 USD',
      ].join('\n');

      assert.equal(
        formatOrThrow(input, {
          alignScope: 'fixed',
          alignMode: 'decimal-and-currency',
          alignColumn: 30,
        }),
        [
          '2026-05-01 * "Two decimals"',
          '  Assets:Cash              10.50  USD',
          '',
          '2026-05-02 * "Three decimals"',
          '  Assets:Cash              10.125 USD',
          '',
        ].join('\n'),
      );

      // Overflowing outlier rows are excluded from fixedFracWidth so they do
      // not over-pad non-overflowing rows.
      const withOutlier = [
        '2026-05-01 * "Outlier"',
        '  Assets:Cash  10.50 USD',
        '  Assets:Very:Very:Long:Outlier:Account:Name  10.123456 USD',
      ].join('\n');
      assert.equal(
        formatOrThrow(withOutlier, {
          alignScope: 'fixed',
          alignMode: 'decimal-and-currency',
          alignColumn: 25,
        }),
        [
          '2026-05-01 * "Outlier"',
          '  Assets:Cash         10.50 USD',
          '  Assets:Very:Very:Long:Outlier:Account:Name  10.123456 USD',
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

      // Uncommented wide sibling rows must not push commented rows far right.
      const mixedComments = [
        '2026-05-01 * "Mixed comments"',
        '  Assets:Cash  -50.00 USD ; paid cash',
        '  Expenses:Books  50.00 USD { 50.00 USD, 2026-05-01, "very-long-lot-label" }',
      ].join('\n');
      assert.equal(
        formatOrThrow(mixedComments, { alignTrailingComments: true }),
        [
          '2026-05-01 * "Mixed comments"',
          '  Assets:Cash    -50.00 USD  ; paid cash',
          '  Expenses:Books  50.00 USD { 50.00 USD, 2026-05-01, "very-long-lot-label" }',
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

    await test('formats interior leading and trailing comments idempotently without gluing tokens', () => {
      const inputs: readonly string[] = [
        'account-rule "r" ; c1\n{ ; c2\n  when a == 1: Assets:Cash\n}\n',
        'account-rule "r"\n; before brace\n{\n  when a == 1: Assets:Cash\n}\n',
        'account-rule "r" {\n  when a == 1 ; cond comment\n    : Assets:Cash\n}\n',
        'account-rule "r" {\n  when a == 1\n    ; before colon\n    : Assets:Cash\n}\n',
        'account-rule "r" {\n  when a\n    ; before eq\n    == 1: Assets:Cash\n}\n',
        'account-rule "r" {\n  when a == 1 and\n    ; before b\n    b == 2: Assets:Cash\n}\n',
        'account-rule "r" {\n  when age > 30 ; days\n    d: Assets:Cash\n}\n',
        'account-rule "r" {\n  when a == 1: Assets:Cash\n    ; before comma\n    ,\n}\n',
        'account-rule "r" {\n  when a == 1: Assets:Cash\n  ; c1\n  , ; c2\n}\n',
        'account-rule "r" {\n  when a == 1: Assets:Cash\n\n  , ; c2\n}\n',
        '2026-05-01 open Assets:Cash\n  key\n    ; before colon\n    : "val"\n',
        '2026-05-01 * "T"\n  Assets:Cash  10 ; c1\n    + ; c2\n    20 USD\n',
        '2026-05-01 * "T"\n  Assets:Cash  10\n    ; before plus\n    + 20 USD\n',
        '2026-05-01 * "T"\n  Assets:Cash  -\n    ; before 10\n    10 USD\n',
        '2026-05-01 * "T"\n  Assets:Stock  10 AAPL { 10\n    ; mid cost comment\n    USD, "tag" }\n',
        '2026-05-01 * "T"\n  Assets:Stock  10 AAPL { 10 USD\n    ; before comma\n    , "tag" }\n',
        '2026-05-01 * "T"\n  choose account\n    ; before brace\n    { when a == 1: Assets:Cash }\n',
      ];

      for (const src of inputs) {
        for (const trailingComma of ['multiline', 'always', 'never'] as const) {
          const pass1 = formatOrThrow(src, { trailingComma });
          const pass2 = formatOrThrow(pass1, { trailingComma });
          assert.equal(pass2, pass1, `Non-idempotent output for:\n${src}`);
          assert(
            !/[^\s];/.test(pass1),
            `Comment glued to preceding token in:\n${pass1}`,
          );
        }
      }
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

      // Synthetic trailing commas on commented final clauses must precede the inline comment.
      const commentedRule = [
        'account-rule "commented" {',
        '  when foo == 1: Assets:Alpha,',
        '  otherwise: fail "nope" ; fallback note',
        '}',
        '',
        '2026-05-01 * "Inline commented"',
        '  choose account {',
        '    when foo == 1: Assets:Alpha ; single note',
        '  }',
      ].join('\n');

      const withSyntheticComma = formatOrThrow(commentedRule, {
        trailingComma: 'multiline',
      });
      assert.equal(
        withSyntheticComma,
        [
          'account-rule "commented" {',
          '  when foo == 1: Assets:Alpha,',
          '  otherwise: fail "nope",  ; fallback note',
          '}',
          '',
          '2026-05-01 * "Inline commented"',
          '  choose account {',
          '    when foo == 1: Assets:Alpha,  ; single note',
          '  }',
          '',
        ].join('\n'),
      );
      assert.equal(
        formatOrThrow(withSyntheticComma, { trailingComma: 'multiline' }),
        withSyntheticComma,
      );
      assert.equal(
        formatOrThrow(commentedRule, { trailingComma: 'never' }),
        [
          'account-rule "commented" {',
          '  when foo == 1: Assets:Alpha,',
          '  otherwise: fail "nope"  ; fallback note',
          '}',
          '',
          '2026-05-01 * "Inline commented"',
          '  choose account {',
          '    when foo == 1: Assets:Alpha  ; single note',
          '  }',
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

    await test('normalizes CRLF line endings inside ; ledger-fmt: off regions', () => {
      const input =
        '2026-01-01 open Assets:Cash\r\n; ledger-fmt: off\r\n2026-01-02   open   Assets:Bank\r\n; ledger-fmt: on\r\n2026-01-03 open Assets:Savings\r\n';
      const formatted = formatOrThrow(input);
      assert(!formatted.includes('\r'));
      assert.equal(formatOrThrow(formatted), formatted);
    });

    await test('preserves leading indentation on indented ; ledger-fmt: off lines', () => {
      const input = [
        '  ; ledger-fmt: off',
        '  2026-01-01   open   Assets:Bank',
        '  ; ledger-fmt: on',
        '',
      ].join('\n');
      assert.equal(formatOrThrow(input), input);
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

      const narrow = formatOrThrow(input, { printWidth: 50 });
      assert.equal(formatOrThrow(narrow, { printWidth: 50 }), narrow);
      assert.equal(
        narrow,
        [
          'account-rule "wrap-test" {',
          '  when',
          '    description == "Supermarket"',
          '    and narration == "Weekly groceries"',
          '    and amount >= 100.00 USD:',
          '    Expenses:Food:Groceries,',
          '}',
          '',
          '2026-05-01 * "Long cost spec"',
          '  Assets:Investments  10 AAPL {',
          '    185.50 USD, 2026-05-01 14:30:00 Z,',
          '    "lot-primary-2026"',
          '  } @ 190.00 USD',
          '  Assets:Cash  -(',
          '    100 + 200 + 300 + 400 + 500 + 600',
          '  ) USD',
          '',
        ].join('\n'),
      );
    });

    await test('accounts for posting prefix width when wrapping cost specs and balance tolerances', () => {
      const postingSrc = [
        '2026-05-01 * "Long account prefix"',
        '  Assets:Investments:Brokerage:MainAccount  10 AAPL { 185.50 USD, 2026-05-01, "lot-1" }',
      ].join('\n');

      assert.equal(
        formatOrThrow(postingSrc, { printWidth: 70 }),
        [
          '2026-05-01 * "Long account prefix"',
          '  Assets:Investments:Brokerage:MainAccount  10 AAPL {',
          '    185.50 USD, 2026-05-01, "lot-1"',
          '  }',
          '',
        ].join('\n'),
      );
      assert.equal(
        formatOrThrow(postingSrc, {
          printWidth: 70,
          costSpecWrapStyle: 'expanded',
        }),
        [
          '2026-05-01 * "Long account prefix"',
          '  Assets:Investments:Brokerage:MainAccount  10 AAPL {',
          '    185.50 USD,',
          '    2026-05-01,',
          '    "lot-1"',
          '  }',
          '',
        ].join('\n'),
      );

      const balanceSrc = [
        '2026-05-01 balance',
        '  Assets:Cash  100 USD ~ (0.01 + 0.02 + 0.03 + 0.04 + 0.05 + 0.06)',
      ].join('\n');
      const wrappedBalance = formatOrThrow(balanceSrc, { printWidth: 40 });
      assert(wrappedBalance.includes('\n    0.01'));
      assert.equal(
        formatOrThrow(wrappedBalance, { printWidth: 40 }),
        wrappedBalance,
      );

      // Suffix wrapping accounts for the post-alignment column and keeps the amount aligned.
      const alignedCostSrc = [
        '2026-05-01 * "Buy"',
        '  Assets:Brokerage:Retirement:LongAccountName  -1000.00 USD',
        '  Assets:Stock  10 AAPL { 100.00 USD, 2026-05-01, "lot-label" } @ 100.00 USD',
      ].join('\n');
      const alignedCostCompact = formatOrThrow(alignedCostSrc, {
        printWidth: 88,
      });
      assert.equal(
        alignedCostCompact,
        [
          '2026-05-01 * "Buy"',
          '  Assets:Brokerage:Retirement:LongAccountName  -1000.00 USD',
          '  Assets:Stock                                       10 AAPL {',
          '    100.00 USD, 2026-05-01, "lot-label"',
          '  } @ 100.00 USD',
          '',
        ].join('\n'),
      );
      assert.equal(
        formatOrThrow(alignedCostCompact, { printWidth: 88 }),
        alignedCostCompact,
      );

      const alignedCostExpanded = formatOrThrow(alignedCostSrc, {
        printWidth: 88,
        costSpecWrapStyle: 'expanded',
      });
      assert.equal(
        alignedCostExpanded,
        [
          '2026-05-01 * "Buy"',
          '  Assets:Brokerage:Retirement:LongAccountName  -1000.00 USD',
          '  Assets:Stock                                       10 AAPL {',
          '    100.00 USD,',
          '    2026-05-01,',
          '    "lot-label"',
          '  } @ 100.00 USD',
          '',
        ].join('\n'),
      );
      assert.equal(
        formatOrThrow(alignedCostExpanded, {
          printWidth: 88,
          costSpecWrapStyle: 'expanded',
        }),
        alignedCostExpanded,
      );
    });

    await test('supports compact vs expanded costSpecWrapStyle with inline comments', () => {
      const input = [
        '2026-05-01 * "Commented cost"',
        '  Assets:Stock  10 AAPL {',
        '    100.00 USD,',
        '    2026-05-01, ; acquisition date',
        '    "lot-1",',
        '    "lot-2"',
        '  }',
      ].join('\n');

      const compact = formatOrThrow(input, { costSpecWrapStyle: 'compact' });
      assert.equal(
        compact,
        [
          '2026-05-01 * "Commented cost"',
          '  Assets:Stock  10 AAPL {',
          '    100.00 USD, 2026-05-01,  ; acquisition date',
          '    "lot-1", "lot-2"',
          '  }',
          '',
        ].join('\n'),
      );
      assert.equal(
        formatOrThrow(compact, { costSpecWrapStyle: 'compact' }),
        compact,
      );

      const expanded = formatOrThrow(input, { costSpecWrapStyle: 'expanded' });
      assert.equal(
        expanded,
        [
          '2026-05-01 * "Commented cost"',
          '  Assets:Stock  10 AAPL {',
          '    100.00 USD,',
          '    2026-05-01,  ; acquisition date',
          '    "lot-1",',
          '    "lot-2"',
          '  }',
          '',
        ].join('\n'),
      );
      assert.equal(
        formatOrThrow(expanded, { costSpecWrapStyle: 'expanded' }),
        expanded,
      );
    });

    await test('shifts non-canonical comments in choose account postings to canonical slots', () => {
      const input = [
        '2026-05-01 * "Choice continuations"',
        '  ! ; flag note',
        '  choose account "my-rule"',
        '  choose account',
        '    ; ref note',
        '    "other-rule"',
        '  choose account',
        '    ; brace note',
        '    { when a == 1: Assets:Cash }',
      ].join('\n');

      const formatted = formatOrThrow(input);
      assert.equal(
        formatted,
        [
          '2026-05-01 * "Choice continuations"',
          '  ! choose account "my-rule"  ; flag note',
          '  choose account "other-rule"  ; ref note',
          '  choose account {  ; brace note',
          '    when a == 1: Assets:Cash,',
          '  }',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(formatted), formatted);
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

    await test('keeps long directive headers and atomic metadata values intact without splitting onto body indentation', () => {
      const input = [
        '2026-05-01 * "This is a very long transaction description that exceeds the default printWidth of 88 characters easily"',
        '  note: "This is also a very long metadata string value that exceeds 88 characters in total length on this line"',
        '  Assets:Cash  -10 USD',
        '  Expenses:Food  10 USD',
        '',
        '2026-05-01 open Assets:Very:Long:Account:Hierarchy:Path:That:Exceeds:Print:Width USD EUR CHF',
      ].join('\n');

      const formatted = formatOrThrow(input, { printWidth: 60 });
      assert.equal(
        formatted,
        [
          '2026-05-01 * "This is a very long transaction description that exceeds the default printWidth of 88 characters easily"',
          '  note: "This is also a very long metadata string value that exceeds 88 characters in total length on this line"',
          '  Assets:Cash   -10 USD',
          '  Expenses:Food  10 USD',
          '',
          '2026-05-01 open Assets:Very:Long:Account:Hierarchy:Path:That:Exceeds:Print:Width',
          '  USD',
          '  EUR',
          '  CHF',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(formatted, { printWidth: 60 }), formatted);
    });

    await test('keeps posting account and amount inline when comments appear inside a cost spec', () => {
      const input = [
        '2026-05-01 * "Lot with interior comment"',
        '  Assets:Stock 10 AAPL {',
        '    10 USD',
        '    ; lot note',
        '  } @ 12 USD',
      ].join('\n');

      const formatted = formatOrThrow(input);
      assert.equal(
        formatted,
        [
          '2026-05-01 * "Lot with interior comment"',
          '  Assets:Stock  10 AAPL {',
          '    10 USD',
          '    ; lot note',
          '  } @ 12 USD',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(formatted), formatted);
    });

    await test('shifts mid-token comments to canonical slots and normalizes empty cost specs', () => {
      const amountCommentSrc = [
        '2026-05-01 * "Amount comment"',
        '  Assets:Bank',
        '    ; about amount',
        '    100 CHF',
        '  Expenses:Food  -100 CHF',
      ].join('\n');
      assert.equal(
        formatOrThrow(amountCommentSrc),
        [
          '2026-05-01 * "Amount comment"',
          '  Assets:Bank     100 CHF  ; about amount',
          '  Expenses:Food  -100 CHF',
          '',
        ].join('\n'),
      );

      const parenCommentSrc = [
        '2026-05-01 * "Paren comment"',
        '  Assets:Bank  (100 + 200',
        '    ; before close paren',
        '  ) CHF',
        '',
        'account-rule "paren-cond" {',
        '  when (a == 1',
        '    ; before close paren',
        '  ): Assets:Bank,',
        '}',
      ].join('\n');
      const parenFormatted = formatOrThrow(parenCommentSrc);
      assert.equal(
        parenFormatted,
        [
          '2026-05-01 * "Paren comment"',
          '  Assets:Bank  (100 + 200) CHF  ; before close paren',
          '',
          'account-rule "paren-cond" {',
          '  when (a == 1): Assets:Bank,  ; before close paren',
          '}',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(parenFormatted), parenFormatted);

      const emptyCostSpecSrc = [
        '2026-05-01 * "Empty cost specs"',
        '  Assets:Stock  10 AAPL {',
        '',
        '  }',
        '  Assets:Other  10 AAPL',
        '',
        '  {}',
      ].join('\n');
      const emptyCostFormatted = formatOrThrow(emptyCostSpecSrc);
      assert.equal(
        emptyCostFormatted,
        [
          '2026-05-01 * "Empty cost specs"',
          '  Assets:Stock  10 AAPL {}',
          '  Assets:Other  10 AAPL {}',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(emptyCostFormatted), emptyCostFormatted);

      const ruleHeaderCommentSrc = [
        'account-rule ; kw comment',
        '  "r" {',
        '  when a == 1: Assets:Bank,',
        '}',
      ].join('\n');
      const ruleHeaderFormatted = formatOrThrow(ruleHeaderCommentSrc);
      assert.equal(
        ruleHeaderFormatted,
        [
          'account-rule "r" {  ; kw comment',
          '  when a == 1: Assets:Bank,',
          '}',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(ruleHeaderFormatted), ruleHeaderFormatted);
    });

    await test('preserves canonical and/or comment slots and hoists earlier multi-comments in order', () => {
      const andOrSrc = [
        'account-rule "routing" {',
        '  when',
        '    payee == "ACME"  ; vendor match',
        '    ; threshold check',
        '    and amount > 100 USD:',
        '    Expenses:Supplies,',
        '  when',
        '    (',
        '      payee == "ALPHA"  ; primary',
        '      or payee == "BETA"',
        '    )',
        '    and direction is debit:',
        '    Expenses:Other,',
        '}',
      ].join('\n');
      const andOrFormatted = formatOrThrow(andOrSrc);
      assert.equal(andOrFormatted, `${andOrSrc}\n`);
      assert.equal(formatOrThrow(andOrFormatted), andOrFormatted);

      // Multiple mid-token comments hoist earlier ones above and keep the last
      // comment at the end of the construct without reordering.
      const multiMidSrc = [
        '2026-05-01 ; c1',
        '  * ; c2',
        '  "Groceries" ; c3',
        '  Assets:Stock ; c4',
        '  10 AAPL { ; c5',
        '    100 USD ; c6',
        '    , "tag"',
        '  } ; c7',
        '  @ 110 USD ; c8',
      ].join('\n');
      const multiMidFormatted = formatOrThrow(multiMidSrc);
      assert.equal(
        multiMidFormatted,
        [
          '; c1',
          '; c2',
          '2026-05-01 * "Groceries"  ; c3',
          '  ; c4',
          '  Assets:Stock  10 AAPL {  ; c5',
          '    100 USD,  ; c6',
          '    "tag"',
          '  }  ; c7',
          '    @ 110 USD  ; c8',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(multiMidFormatted), multiMidFormatted);
    });

    await test('keeps @/@@ and price on the same line when wrapping long price annotations', () => {
      const input = [
        '2026-05-01 * "Buy"',
        '  Assets:Very:Long:Account:Name  10 AAPL @ 190.00 USD',
        '  Assets:Very:Long:Account:Name  10 AAPL @@ 1,900.00 USD',
        '  Assets:Very:Long:Account:Name  10 AAPL { 185.00 USD } @ 190.00 USD',
      ].join('\n');

      const wrapped = formatOrThrow(input, { printWidth: 45 });
      assert.equal(
        wrapped,
        [
          '2026-05-01 * "Buy"',
          '  Assets:Very:Long:Account:Name  10 AAPL',
          '    @ 190.00 USD',
          '  Assets:Very:Long:Account:Name  10 AAPL',
          '    @@ 1,900.00 USD',
          '  Assets:Very:Long:Account:Name  10 AAPL {',
          '    185.00 USD',
          '  } @ 190.00 USD',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(wrapped, { printWidth: 45 }), wrapped);

      // Even below the width of "@ 190.00 USD", "@" and the price stay together.
      const ultraNarrow = formatOrThrow(
        '2026-05-01 * "Tiny"\n  Assets:Stock  10 AAPL @ 190.00 USD\n',
        { printWidth: 10 },
      );
      assert.equal(
        ultraNarrow,
        [
          '2026-05-01 * "Tiny"',
          '  Assets:Stock  10 AAPL',
          '    @ 190.00 USD',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(ultraNarrow, { printWidth: 10 }), ultraNarrow);
    });

    await test('strips bare trailing blank lines before closing braces and parentheses while keeping comments', () => {
      const input = [
        'account-rule "r" {',
        '  when a == 1: Assets:Cash',
        '',
        '}',
        '',
        '2026-05-01 * "Closing blank lines"',
        '  Assets:Stock  (',
        '    10',
        '',
        '  ) USD {',
        '    10 USD',
        '',
        '  }',
        '  Assets:Other  10 AAPL {',
        '    10 USD',
        '    ; kept comment',
        '',
        '  }',
        '  choose account { when a == 1: Assets:Cash',
        '',
        '  }',
      ].join('\n');

      const formatted = formatOrThrow(input);
      assert.equal(
        formatted,
        [
          'account-rule "r" {',
          '  when a == 1: Assets:Cash,',
          '}',
          '',
          '2026-05-01 * "Closing blank lines"',
          '  Assets:Stock  (10) USD { 10 USD }',
          '  Assets:Other    10 AAPL {',
          '    10 USD',
          '    ; kept comment',
          '  }',
          '  choose account { when a == 1: Assets:Cash }',
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

  await describe('robustness and pathological inputs', async () => {
    await test('preserves both comments separated by a lone CR line ending', () => {
      const input =
        '2026-05-01 * "Coffee" ; first\r; second\n  Assets:Cash  10 USD\n';
      const formatted = formatOrThrow(input);
      assert.equal(
        formatted,
        [
          '2026-05-01 * "Coffee"  ; first',
          '  ; second',
          '  Assets:Cash  10 USD',
          '',
        ].join('\n'),
      );
      assert.equal(formatOrThrow(formatted), formatted);
    });

    await test('formats very long numbers and whitespace-padded comments in linear time', () => {
      const hugeDigits = '1'.repeat(25_000);
      const numSrc = `2026-05-01 * "Huge"\n  Assets:Cash  ${hugeDigits} USD\n`;
      const formattedNum = formatOrThrow(numSrc, { thousandsSeparator: 'add' });
      assert(formattedNum.includes('1,111,111'));

      const paddedComment = `;${' '.repeat(50_000)}end\n2026-05-01 open Assets:Cash USD\n`;
      const formattedComment = formatOrThrow(paddedComment);
      assert(formattedComment.startsWith(';'));
      assert(formattedComment.includes('end\n'));
    });

    await test('formats long flat arithmetic and boolean chains without stack overflow', () => {
      const longSum = `2026-05-01 * "Long sum"\n  Assets:Cash  ${Array(5_000).fill('1').join(' + ')} USD\n`;
      const formattedSum = formatOrThrow(longSum);
      assert.equal(formatOrThrow(formattedSum), formattedSum);

      const longCond = `account-rule "long" {\n  when ${Array(1_500).fill('a == 1').join(' and ')}: Assets:Cash,\n}\n`;
      const formattedCond = formatOrThrow(longCond);
      assert.equal(formatOrThrow(formattedCond), formattedCond);

      // Deeply nested expressions and conditions up to parser depth cap (256)
      // also format cleanly with recursion.
      const nestedExpr = `2026-05-01 * "Nested expr"\n  Assets:Cash  ${'('.repeat(200)}1${')'.repeat(200)} USD\n`;
      const formattedNestedExpr = formatOrThrow(nestedExpr);
      assert.equal(formatOrThrow(formattedNestedExpr), formattedNestedExpr);

      const nestedCond = `account-rule "nested" {\n  when ${'not '.repeat(200)}a == 1: Assets:Cash,\n}\n`;
      const formattedNestedCond = formatOrThrow(nestedCond);
      assert.equal(formatOrThrow(formattedNestedCond), formattedNestedCond);
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
      [
        'narrow printWidth=45 + costSpecWrapStyle=expanded',
        { printWidth: 45, costSpecWrapStyle: 'expanded' },
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
