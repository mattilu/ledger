import { strict as assert } from 'node:assert';
import { basename } from 'node:path';
import { describe, test } from 'node:test';

import { either as E, function as F } from 'fp-ts';
import { glob, readFile } from 'fs/promises';

import { Directive } from './directive.js';
import {
  AccountChoiceRule,
  AccountRuleDirective,
  ConditionExpression,
  ConditionLiteral,
} from './directives/account-choice.js';
import { CurrencyDirective } from './directives/currency.js';
import {
  AccountChoice,
  AccountPosting,
  Posting,
} from './directives/transaction.js';
import { Ledger } from './ledger.js';
import { load } from './loader.js';
import { Metadata } from './metadata.js';

type TestOptions = {
  readonly compareOptionMap?: boolean;
  readonly compareAccountMap?: boolean;
  readonly compareSignConventions?: boolean;
  readonly maxDate?: string;
};

function* dateFilter(date: Date, directives: Iterable<Directive>) {
  for (const directive of directives) {
    if (directive.date.getTime() > date.getTime()) {
      return;
    }
    yield true;
  }
}

const loadForTest = async (path: string, options?: TestOptions) =>
  F.pipe(
    await load(path, {
      takeWhile: options?.maxDate
        ? directives => dateFilter(new Date(options.maxDate!), directives)
        : undefined,
    }),
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
  for await (const f of glob([`${dirname}**/*.json`], {
    exclude: f => basename(f).startsWith('_'),
  })) {
    tests.push({
      testName: f.replace(dirname, '').replace('.json', ''),
      srcPath: f.replace(/([.][\w-]+)?[.]json/, '.ledger'),
      wantPath: f,
    });
  }

  // Make sure we have test data
  assert(tests.length > 0);

  for (const t of tests) {
    await test(t.testName, async ctx => {
      const { options } = JSON.parse(
        await readFile(t.wantPath, { encoding: 'utf-8' }),
      );
      const got = await loadForTest(t.srcPath, options);

      ctx.assert.fileSnapshot({ options, want: got }, t.wantPath, {
        serializers: [x => JSON.stringify(x, null, 2) + '\n'],
      });
    });
  }

  await test('non-existing file', async () => {
    const got = await loadForTest('non-existing.ledger');
    assert(E.isLeft(got));
    assert.match(got.left.error, /no such file or directory/);
  });
});

function cleanup(ledger: Ledger, options?: TestOptions) {
  function cleanupDirective(
    directive: Directive | CurrencyDirective | AccountRuleDirective,
  ) {
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
              normalBalanceSide: options?.compareSignConventions
                ? b.normalBalanceSide
                : undefined,
            }))
          : undefined,
      rules:
        directive.type === 'account-rule'
          ? cleanupAccountChoiceRules(directive.rules)
          : undefined,
      srcCtx: undefined,
      meta: cleanupMeta(directive.meta),
      optionMap: options?.compareOptionMap ? directive.optionMap : undefined,
      accountMap: undefined,
      signConvention:
        options?.compareSignConventions && 'signConvention' in directive
          ? directive.signConvention
          : undefined,
    };
  }

  function cleanupPosting(posting: Posting) {
    return {
      ...posting,
      account:
        typeof posting.account === 'string'
          ? posting.account
          : cleanupAccountChoice(posting.account),
      meta: cleanupMeta(posting.meta),
      normalBalanceSide:
        options?.compareSignConventions && isAccountPosting(posting)
          ? posting.normalBalanceSide
          : undefined,
    };
  }

  function cleanupAccountChoice(choice: AccountChoice) {
    return {
      ...choice,
      rules:
        choice.type === 'inline'
          ? cleanupAccountChoiceRules(choice.rules)
          : undefined,
    };
  }

  function cleanupAccountChoiceRules(rules: readonly AccountChoiceRule[]) {
    return rules.map(rule =>
      rule.type === 'otherwise'
        ? rule
        : { ...rule, condition: cleanupCondition(rule.condition) },
    );
  }

  function cleanupCondition(condition: ConditionExpression): object {
    if (condition.type === 'comparison') {
      return {
        ...condition,
        value: cleanupConditionLiteral(condition.value),
      };
    }
    if (condition.type === 'not') {
      return {
        ...condition,
        expression: cleanupCondition(condition.expression),
      };
    }
    return {
      ...condition,
      lhs: cleanupCondition(condition.lhs),
      rhs: cleanupCondition(condition.rhs),
    };
  }

  function cleanupConditionLiteral(literal: ConditionLiteral) {
    if (literal.type === 'number' || literal.type === 'duration') {
      return { ...literal, value: literal.value.toNumber() };
    }
    return literal;
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
    ...ledger,
    directives: ledger.directives.map(directive => cleanupDirective(directive)),
    currencyMap: ledger.currencyMap.isEmpty()
      ? undefined
      : ledger.currencyMap.map(directive => cleanupDirective(directive)),
    accountRuleMap: ledger.accountRuleMap.isEmpty()
      ? undefined
      : ledger.accountRuleMap.map(accountRule => cleanupDirective(accountRule)),
    accountMap: options?.compareAccountMap ? ledger.accountMap : undefined,
    signConvention: options?.compareSignConventions
      ? ledger.signConvention
      : undefined,
  };
}

function canonicalize<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function isAccountPosting(posting: Posting): posting is AccountPosting {
  return typeof posting.account === 'string';
}
