import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ExactNumber } from 'exactnumber';
import { either as E } from 'fp-ts';

import {
  AccountChoiceRule,
  ConditionExpression,
  ConditionLiteral,
} from '../../loading/directives/account-choice.js';
import {
  AccountChoiceAggregateFacts,
  AccountChoiceReductionFacts,
  compileAccountChoiceRules,
} from './account-choice.js';

type ComparisonOperator = Extract<
  ConditionExpression,
  { type: 'comparison' }
>['operator'];

const cmp = (
  attribute: string,
  operator: ComparisonOperator,
  value: ConditionLiteral,
): ConditionExpression => ({ type: 'comparison', attribute, operator, value });

const not = (expression: ConditionExpression): ConditionExpression => ({
  type: 'not',
  expression,
});

const and = (
  lhs: ConditionExpression,
  rhs: ConditionExpression,
): ConditionExpression => ({ type: 'and', lhs, rhs });

const or = (
  lhs: ConditionExpression,
  rhs: ConditionExpression,
): ConditionExpression => ({ type: 'or', lhs, rhs });

const when = (
  condition: ConditionExpression,
  account: string,
): AccountChoiceRule => ({ type: 'when', condition, account });

const otherwise = (account: string): AccountChoiceRule => ({
  type: 'otherwise',
  account,
});

const id = (value: string): ConditionLiteral => ({ type: 'identifier', value });

const acct = (value: string): ConditionLiteral => ({ type: 'account', value });

const curr = (value: string): ConditionLiteral => ({ type: 'currency', value });

const days = (value: number | string): ConditionLiteral => ({
  type: 'duration',
  value: ExactNumber(value),
  unit: 'd',
});

const str = (value: string): ConditionLiteral => ({ type: 'string', value });

const num = (value: number | string): ConditionLiteral => ({
  type: 'number',
  value: ExactNumber(value),
});

const aggregateFacts = (
  overrides?: Partial<Omit<AccountChoiceAggregateFacts, 'context'>>,
): AccountChoiceAggregateFacts => ({
  context: 'aggregate',
  direction: overrides?.direction ?? 'debit',
  currency: overrides?.currency ?? 'USD',
});

const aggregateDebit = aggregateFacts({ direction: 'debit' });

const aggregateCredit = aggregateFacts({ direction: 'credit' });

const reductionFacts = (
  overrides?: Partial<Omit<AccountChoiceReductionFacts, 'context'>>,
): AccountChoiceReductionFacts => ({
  context: 'reduction',
  direction: overrides?.direction ?? 'credit',
  currency: overrides?.currency ?? 'USD',
  sourceAccount: overrides?.sourceAccount ?? 'Assets:Broker:Foo',
  sourceCurrency: overrides?.sourceCurrency ?? 'ACME',
  holdingPeriod: overrides?.holdingPeriod ?? ExactNumber(400),
});

describe('compileAccountChoiceRules', () => {
  describe('compilation errors', () => {
    it('fails on invalid direction identifier', () => {
      const got = compileAccountChoiceRules([
        when(cmp('direction', 'is', id('inbound')), 'Expenses:Loss'),
      ]);

      assert(E.isLeft(got));
      assert.equal(
        got.left.message,
        'Invalid account-choice direction; expected debit or credit',
      );
    });

    it('fails on invalid context identifier', () => {
      const got = compileAccountChoiceRules([
        when(cmp('context', 'is', id('posting')), 'Expenses:Loss'),
      ]);

      assert(E.isLeft(got));
      assert.equal(
        got.left.message,
        'Invalid account-choice context; expected reduction or aggregate',
      );
    });

    describe('type mismatch', () => {
      it('fails on direction type mismatch', () => {
        const got = compileAccountChoiceRules([
          when(cmp('direction', 'is', str('debit')), 'Expenses:Loss'),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          "Cannot compare account-choice values of types 'identifier' and 'string'",
        );
      });

      it('fails on context type mismatch', () => {
        const got = compileAccountChoiceRules([
          when(cmp('context', 'is', str('aggregate')), 'Expenses:Loss'),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          "Cannot compare account-choice values of types 'identifier' and 'string'",
        );
      });

      it('fails on currency type mismatch', () => {
        const got = compileAccountChoiceRules([
          when(cmp('currency', 'is', str('USD')), 'Income:Gain'),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          "Cannot compare account-choice values of types 'currency' and 'string'",
        );
      });

      it('fails on source-account type mismatch', () => {
        const got = compileAccountChoiceRules([
          when(
            cmp('source-account', 'is', str('Assets:Broker:Foo')),
            'Income:Gain',
          ),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          "Cannot compare account-choice values of types 'account' and 'string'",
        );
      });

      it('fails on source-currency type mismatch', () => {
        const got = compileAccountChoiceRules([
          when(cmp('source-currency', 'is', str('ACME')), 'Income:Gain'),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          "Cannot compare account-choice values of types 'currency' and 'string'",
        );
      });

      it('fails on holding-period type mismatch', () => {
        const got = compileAccountChoiceRules([
          when(cmp('holding-period', '>=', num(365)), 'Income:Gain'),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          "Cannot compare account-choice values of types 'duration' and 'number'",
        );
      });
    });

    describe('ordered comparison', () => {
      for (const op of ['<', '<=', '>', '>='] as const) {
        it(`fails on '${op}' comparison for direction`, () => {
          const got = compileAccountChoiceRules([
            when(cmp('direction', op, id('debit')), 'Expenses:Loss'),
          ]);

          assert(E.isLeft(got));
          assert.equal(
            got.left.message,
            'Ordered comparison is not valid for account-choice identifier',
          );
        });

        it(`fails on '${op}' comparison for context`, () => {
          const got = compileAccountChoiceRules([
            when(cmp('context', op, id('aggregate')), 'Expenses:Loss'),
          ]);

          assert(E.isLeft(got));
          assert.equal(
            got.left.message,
            'Ordered comparison is not valid for account-choice identifier',
          );
        });

        it(`fails on '${op}' comparison for currency`, () => {
          const got = compileAccountChoiceRules([
            when(cmp('currency', op, curr('USD')), 'Income:Gain'),
          ]);

          assert(E.isLeft(got));
          assert.equal(
            got.left.message,
            'Ordered comparison is not valid for account-choice currency',
          );
        });

        it(`fails on '${op}' comparison for source-account`, () => {
          const got = compileAccountChoiceRules([
            when(
              cmp('source-account', op, acct('Assets:Broker:Foo')),
              'Income:Gain',
            ),
          ]);

          assert(E.isLeft(got));
          assert.equal(
            got.left.message,
            'Ordered comparison is not valid for account-choice account',
          );
        });

        it(`fails on '${op}' comparison for source-currency`, () => {
          const got = compileAccountChoiceRules([
            when(cmp('source-currency', op, curr('ACME')), 'Income:Gain'),
          ]);

          assert(E.isLeft(got));
          assert.equal(
            got.left.message,
            'Ordered comparison is not valid for account-choice currency',
          );
        });
      }
    });

    it('fails on unknown attribute', () => {
      const got = compileAccountChoiceRules([
        when(cmp('unknown-attr', 'is', id('debit')), 'Expenses:Loss'),
      ]);

      assert(E.isLeft(got));
      assert.equal(
        got.left.message,
        'Unknown account-choice attribute: unknown-attr',
      );
    });

    it('fails on invalid condition expression type', () => {
      const invalidCondition = {
        type: 'xor',
      } as unknown as ConditionExpression;
      const got = compileAccountChoiceRules([
        when(invalidCondition, 'Expenses:Loss'),
      ]);

      assert(E.isLeft(got));
      assert.equal(got.left.message, 'Invalid account-choice condition xor');
    });

    describe('error propagation', () => {
      it('propagates compilation errors through not', () => {
        const got = compileAccountChoiceRules([
          when(not(cmp('bad-attr', 'is', id('debit'))), 'Expenses:Loss'),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          'Unknown account-choice attribute: bad-attr',
        );
      });

      it('propagates compilation errors from left of and', () => {
        const got = compileAccountChoiceRules([
          when(
            and(
              cmp('bad-left', 'is', id('debit')),
              cmp('direction', 'is', id('debit')),
            ),
            'Expenses:Loss',
          ),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          'Unknown account-choice attribute: bad-left',
        );
      });

      it('propagates compilation errors from right of and', () => {
        const got = compileAccountChoiceRules([
          when(
            and(
              cmp('direction', 'is', id('debit')),
              cmp('bad-right', 'is', id('debit')),
            ),
            'Expenses:Loss',
          ),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          'Unknown account-choice attribute: bad-right',
        );
      });

      it('propagates compilation errors from left of or', () => {
        const got = compileAccountChoiceRules([
          when(
            or(
              cmp('bad-left', 'is', id('debit')),
              cmp('direction', 'is', id('debit')),
            ),
            'Expenses:Loss',
          ),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          'Unknown account-choice attribute: bad-left',
        );
      });

      it('propagates compilation errors from right of or', () => {
        const got = compileAccountChoiceRules([
          when(
            or(
              cmp('direction', 'is', id('debit')),
              cmp('bad-right', 'is', id('debit')),
            ),
            'Expenses:Loss',
          ),
        ]);

        assert(E.isLeft(got));
        assert.equal(
          got.left.message,
          'Unknown account-choice attribute: bad-right',
        );
      });
    });
  });

  describe('rule evaluation', () => {
    it('returns null when rules list is empty', () => {
      const compiled = compileAccountChoiceRules([]);
      assert(E.isRight(compiled));
      assert.deepEqual(compiled.right(aggregateDebit), E.right(null));
    });

    it('returns null when no when rule matches and there is no otherwise rule', () => {
      const compiled = compileAccountChoiceRules([
        when(cmp('direction', 'is', id('credit')), 'Income:Gain'),
      ]);
      assert(E.isRight(compiled));
      assert.deepEqual(compiled.right(aggregateDebit), E.right(null));
    });

    it('returns the first matching rule in order and falls back to otherwise', () => {
      const compiled = compileAccountChoiceRules([
        when(
          and(
            cmp('context', 'is', id('reduction')),
            cmp('holding-period', '>=', days(365)),
          ),
          'Income:Gain:LongTerm',
        ),
        when(cmp('direction', 'is', id('credit')), 'Income:Gain:ShortTerm'),
        otherwise('Expenses:Loss'),
      ]);
      assert(E.isRight(compiled));

      assert.deepEqual(
        compiled.right(reductionFacts({ holdingPeriod: ExactNumber(400) })),
        E.right('Income:Gain:LongTerm'),
      );
      assert.deepEqual(
        compiled.right(reductionFacts({ holdingPeriod: ExactNumber(100) })),
        E.right('Income:Gain:ShortTerm'),
      );
      assert.deepEqual(
        compiled.right(aggregateDebit),
        E.right('Expenses:Loss'),
      );
    });

    it('evaluates direction comparisons for all equality operators', () => {
      const ops: Array<[ComparisonOperator, boolean, boolean]> = [
        ['is', true, false],
        ['==', true, false],
        ['is not', false, true],
        ['!=', false, true],
      ];

      for (const [op, matchDebit, matchCredit] of ops) {
        const compiled = compileAccountChoiceRules([
          when(cmp('direction', op, id('debit')), 'Expenses:Loss'),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(
          compiled.right(aggregateDebit),
          E.right(matchDebit ? 'Expenses:Loss' : null),
        );
        assert.deepEqual(
          compiled.right(aggregateCredit),
          E.right(matchCredit ? 'Expenses:Loss' : null),
        );
      }
    });

    it('evaluates context comparisons for all equality operators', () => {
      const ops: Array<[ComparisonOperator, boolean, boolean]> = [
        ['is', true, false],
        ['==', true, false],
        ['is not', false, true],
        ['!=', false, true],
      ];

      for (const [op, matchAggregate, matchReduction] of ops) {
        const compiled = compileAccountChoiceRules([
          when(cmp('context', op, id('aggregate')), 'Equity:Aggregate'),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(
          compiled.right(aggregateDebit),
          E.right(matchAggregate ? 'Equity:Aggregate' : null),
        );
        assert.deepEqual(
          compiled.right(reductionFacts()),
          E.right(matchReduction ? 'Equity:Aggregate' : null),
        );
      }
    });

    it('evaluates currency comparisons in both aggregate and reduction contexts', () => {
      const ops: Array<[ComparisonOperator, boolean, boolean]> = [
        ['is', true, false],
        ['==', true, false],
        ['is not', false, true],
        ['!=', false, true],
      ];

      for (const [op, matchUsd, matchEur] of ops) {
        const compiled = compileAccountChoiceRules([
          when(cmp('currency', op, curr('USD')), 'Income:Usd'),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(
          compiled.right(aggregateFacts({ currency: 'USD' })),
          E.right(matchUsd ? 'Income:Usd' : null),
        );
        assert.deepEqual(
          compiled.right(aggregateFacts({ currency: 'EUR' })),
          E.right(matchEur ? 'Income:Usd' : null),
        );
        assert.deepEqual(
          compiled.right(reductionFacts({ currency: 'USD' })),
          E.right(matchUsd ? 'Income:Usd' : null),
        );
        assert.deepEqual(
          compiled.right(reductionFacts({ currency: 'EUR' })),
          E.right(matchEur ? 'Income:Usd' : null),
        );
      }
    });

    it('evaluates source-account comparisons in reduction context', () => {
      const ops: Array<[ComparisonOperator, boolean, boolean]> = [
        ['is', true, false],
        ['==', true, false],
        ['is not', false, true],
        ['!=', false, true],
      ];

      for (const [op, matchSame, matchOther] of ops) {
        const compiled = compileAccountChoiceRules([
          when(
            cmp('source-account', op, acct('Assets:Broker:Foo')),
            'Income:Foo',
          ),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(
          compiled.right(
            reductionFacts({ sourceAccount: 'Assets:Broker:Foo' }),
          ),
          E.right(matchSame ? 'Income:Foo' : null),
        );
        assert.deepEqual(
          compiled.right(
            reductionFacts({ sourceAccount: 'Assets:Broker:OTHER' }),
          ),
          E.right(matchOther ? 'Income:Foo' : null),
        );
      }
    });

    it('evaluates source-currency comparisons in reduction context', () => {
      const ops: Array<[ComparisonOperator, boolean, boolean]> = [
        ['is', true, false],
        ['==', true, false],
        ['is not', false, true],
        ['!=', false, true],
      ];

      for (const [op, matchSame, matchOther] of ops) {
        const compiled = compileAccountChoiceRules([
          when(cmp('source-currency', op, curr('ACME')), 'Income:Acme'),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(
          compiled.right(reductionFacts({ sourceCurrency: 'ACME' })),
          E.right(matchSame ? 'Income:Acme' : null),
        );
        assert.deepEqual(
          compiled.right(reductionFacts({ sourceCurrency: 'FOO' })),
          E.right(matchOther ? 'Income:Acme' : null),
        );
      }
    });

    it('evaluates holding-period comparisons for all operators', () => {
      const cases: Array<[ComparisonOperator, number, boolean]> = [
        ['is', 365, true],
        ['is', 100, false],
        ['==', 365, true],
        ['==', 100, false],
        ['is not', 100, true],
        ['is not', 365, false],
        ['!=', 100, true],
        ['!=', 365, false],
        ['<', 364, true],
        ['<', 365, false],
        ['<=', 365, true],
        ['<=', 366, false],
        ['>', 366, true],
        ['>', 365, false],
        ['>=', 365, true],
        ['>=', 364, false],
      ];

      for (const [op, actualDays, expectedMatch] of cases) {
        const compiled = compileAccountChoiceRules([
          when(cmp('holding-period', op, days(365)), 'Income:Target'),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(
          compiled.right(
            reductionFacts({ holdingPeriod: ExactNumber(actualDays) }),
          ),
          E.right(expectedMatch ? 'Income:Target' : null),
        );
      }
    });

    describe('logical operators', () => {
      it('evaluates logical not', () => {
        const compiled = compileAccountChoiceRules([
          when(not(cmp('direction', 'is', id('debit'))), 'Income:Credit'),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(compiled.right(aggregateDebit), E.right(null));
        assert.deepEqual(
          compiled.right(aggregateCredit),
          E.right('Income:Credit'),
        );
      });

      it('evaluates logical and with short-circuiting', () => {
        const compiled = compileAccountChoiceRules([
          when(
            and(
              cmp('context', 'is', id('reduction')),
              cmp('holding-period', '>=', days(365)),
            ),
            'Income:LongTerm',
          ),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(compiled.right(aggregateCredit), E.right(null));
        assert.deepEqual(
          compiled.right(reductionFacts({ holdingPeriod: ExactNumber(400) })),
          E.right('Income:LongTerm'),
        );
      });

      it('evaluates logical or with short-circuiting', () => {
        const compiled = compileAccountChoiceRules([
          when(
            or(
              cmp('context', 'is', id('aggregate')),
              cmp('holding-period', '>=', days(365)),
            ),
            'Income:Matched',
          ),
        ]);
        assert(E.isRight(compiled));
        assert.deepEqual(
          compiled.right(aggregateCredit),
          E.right('Income:Matched'),
        );
        assert.deepEqual(
          compiled.right(reductionFacts({ holdingPeriod: ExactNumber(400) })),
          E.right('Income:Matched'),
        );
        assert.deepEqual(
          compiled.right(reductionFacts({ holdingPeriod: ExactNumber(100) })),
          E.right(null),
        );
      });
    });
  });

  describe('evaluation errors', () => {
    it('fails when source-account is evaluated in aggregate context', () => {
      const compiled = compileAccountChoiceRules([
        when(
          cmp('source-account', 'is', acct('Assets:Broker:Foo')),
          'Income:Gain',
        ),
      ]);
      assert(E.isRight(compiled));

      const got = compiled.right(aggregateCredit);
      assert(E.isLeft(got));
      assert.equal(
        got.left.message,
        'Condition requires source-account, but no reduced lot context is available',
      );
    });

    it('fails when source-currency is evaluated in aggregate context', () => {
      const compiled = compileAccountChoiceRules([
        when(cmp('source-currency', 'is', curr('ACME')), 'Income:Gain'),
      ]);
      assert(E.isRight(compiled));

      const got = compiled.right(aggregateCredit);
      assert(E.isLeft(got));
      assert.equal(
        got.left.message,
        'Condition requires source-currency, but no reduced lot context is available',
      );
    });

    it('fails when holding-period is evaluated in aggregate context', () => {
      const compiled = compileAccountChoiceRules([
        when(cmp('holding-period', '>=', days(365)), 'Income:Gain'),
      ]);
      assert(E.isRight(compiled));

      const got = compiled.right(aggregateCredit);
      assert(E.isLeft(got));
      assert.equal(
        got.left.message,
        'Condition requires holding-period, but no reduced lot context is available',
      );
    });

    describe('error propagation', () => {
      it('propagates evaluation errors through not', () => {
        const compiled = compileAccountChoiceRules([
          when(not(cmp('holding-period', '>=', days(365))), 'Income:Gain'),
        ]);
        assert(E.isRight(compiled));
        assert(E.isLeft(compiled.right(aggregateCredit)));
      });

      it('propagates evaluation errors from left of and', () => {
        const compiled = compileAccountChoiceRules([
          when(
            and(
              cmp('holding-period', '>=', days(365)),
              cmp('direction', 'is', id('credit')),
            ),
            'Income:Gain',
          ),
        ]);
        assert(E.isRight(compiled));
        assert(E.isLeft(compiled.right(aggregateCredit)));
      });

      it('propagates evaluation errors from right of and', () => {
        const compiled = compileAccountChoiceRules([
          when(
            and(
              cmp('direction', 'is', id('credit')),
              cmp('holding-period', '>=', days(365)),
            ),
            'Income:Gain',
          ),
        ]);
        assert(E.isRight(compiled));
        assert(E.isLeft(compiled.right(aggregateCredit)));
      });

      it('propagates evaluation errors from left of or', () => {
        const compiled = compileAccountChoiceRules([
          when(
            or(
              cmp('holding-period', '>=', days(365)),
              cmp('direction', 'is', id('credit')),
            ),
            'Income:Gain',
          ),
        ]);
        assert(E.isRight(compiled));
        assert(E.isLeft(compiled.right(aggregateCredit)));
      });

      it('propagates evaluation errors from right of or and stops rule evaluation', () => {
        const compiled = compileAccountChoiceRules([
          when(
            or(
              cmp('direction', 'is', id('debit')),
              cmp('holding-period', '>=', days(365)),
            ),
            'Income:Gain',
          ),
          otherwise('Income:Fallback'),
        ]);
        assert(E.isRight(compiled));
        assert(E.isLeft(compiled.right(aggregateCredit)));
      });
    });
  });
});
