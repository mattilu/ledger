import { ExactNumberType } from 'exactnumber';
import { either as E, function as F, readonlyArray as RA } from 'fp-ts';

import {
  AccountChoiceRule,
  ConditionExpression,
} from '../../loading/directives/account-choice.js';

/**
 * Booking facts available when evaluating an aggregate balance residual.
 */
export interface AccountChoiceAggregateFacts {
  readonly context: 'aggregate';
  readonly direction: 'debit' | 'credit';
  readonly currency: string;
}

/**
 * Booking facts available when evaluating a realized portion of a reduced lot.
 */
export interface AccountChoiceReductionFacts {
  readonly context: 'reduction';
  readonly direction: 'debit' | 'credit';
  readonly currency: string;
  readonly sourceAccount: string;
  readonly sourceCurrency: string;
  readonly acquisitionDate: Date;
  readonly holdingPeriod: ExactNumberType;
  readonly tags: readonly string[];
}

/**
 * Booking facts passed to an account-choice evaluator.
 */
export type AccountChoiceFacts =
  | AccountChoiceAggregateFacts
  | AccountChoiceReductionFacts;

/**
 * Evaluates compiled account-choice rules against booking facts and returns
 * the first matching account, `null` if no rule matches, or an `Error`.
 */
export type AccountChoiceEvaluator = (
  facts: AccountChoiceFacts,
) => E.Either<Error, string | null>;

/**
 * Compiles a list of account-choice rules into a reusable evaluator function.
 *
 * Static condition errors (such as unknown attributes or invalid enum literals)
 * are reported immediately during compilation.
 *
 * @param rules The account-choice rules to compile, evaluated in source order.
 * @returns Either an `AccountChoiceEvaluator`, or an `Error` if compilation
 *   fails.
 */
export function compileAccountChoiceRules(
  rules: readonly AccountChoiceRule[],
): E.Either<Error, AccountChoiceEvaluator> {
  return F.pipe(
    rules,
    RA.traverse(E.Applicative)(
      (rule): E.Either<Error, AccountChoiceEvaluator> => {
        if (rule.type === 'otherwise') {
          const result = E.right(rule.account);
          return E.right(() => result);
        }
        return F.pipe(
          compileCondition(rule.condition),
          E.map(
            evaluateCondition => facts =>
              F.pipe(
                evaluateCondition(facts),
                E.map(matches => (matches ? rule.account : null)),
              ),
          ),
        );
      },
    ),
    E.map(compiledRules => facts => {
      for (const evaluateRule of compiledRules) {
        const result = evaluateRule(facts);
        if (E.isLeft(result) || result.right !== null) {
          return result;
        }
      }
      return E.right(null);
    }),
  );
}

type ConditionEvaluator = (
  facts: AccountChoiceFacts,
) => E.Either<Error, boolean>;

type ComparisonOperator = Extract<
  ConditionExpression,
  { type: 'comparison' }
>['operator'];

type EqualityOperator = 'is' | '==' | 'is not' | '!=';

function compileCondition(
  condition: ConditionExpression,
): E.Either<Error, ConditionEvaluator> {
  switch (condition.type) {
    case 'not': {
      return F.pipe(
        compileCondition(condition.expression),
        E.map(
          evaluate => facts =>
            F.pipe(
              evaluate(facts),
              E.map(result => !result),
            ),
        ),
      );
    }
    case 'and': {
      return F.pipe(
        E.Do,
        E.bind('evaluateLhs', () => compileCondition(condition.lhs)),
        E.bind('evaluateRhs', () => compileCondition(condition.rhs)),
        E.map(
          ({ evaluateLhs, evaluateRhs }): ConditionEvaluator =>
            facts =>
              F.pipe(
                evaluateLhs(facts),
                E.flatMap(lhs => (!lhs ? E.right(false) : evaluateRhs(facts))),
              ),
        ),
      );
    }
    case 'or': {
      return F.pipe(
        E.Do,
        E.bind('evaluateLhs', () => compileCondition(condition.lhs)),
        E.bind('evaluateRhs', () => compileCondition(condition.rhs)),
        E.map(
          ({ evaluateLhs, evaluateRhs }): ConditionEvaluator =>
            facts =>
              F.pipe(
                evaluateLhs(facts),
                E.flatMap(lhs => (lhs ? E.right(true) : evaluateRhs(facts))),
              ),
        ),
      );
    }
    case 'comparison': {
      switch (condition.attribute) {
        case 'direction': {
          if (condition.value.type !== 'identifier') {
            return invalidTypeComparison('identifier', condition.value.type);
          }
          const expectedDirection = condition.value.value;
          if (!['debit', 'credit'].includes(expectedDirection)) {
            return E.left(
              new Error(
                'Invalid account-choice direction; expected debit or credit',
              ),
            );
          }
          return F.pipe(
            validateEqualityOperator(condition.operator, 'identifier'),
            E.map(
              (operator): ConditionEvaluator =>
                facts =>
                  E.right(
                    compareEquality(
                      facts.direction === expectedDirection,
                      operator,
                    ),
                  ),
            ),
          );
        }
        case 'context': {
          if (condition.value.type !== 'identifier') {
            return invalidTypeComparison('identifier', condition.value.type);
          }
          const expectedContext = condition.value.value;
          if (!['reduction', 'aggregate'].includes(expectedContext)) {
            return E.left(
              new Error(
                'Invalid account-choice context; expected reduction or aggregate',
              ),
            );
          }
          return F.pipe(
            validateEqualityOperator(condition.operator, 'identifier'),
            E.map(
              (operator): ConditionEvaluator =>
                facts =>
                  E.right(
                    compareEquality(
                      facts.context === expectedContext,
                      operator,
                    ),
                  ),
            ),
          );
        }
        case 'currency': {
          if (condition.value.type !== 'currency') {
            return invalidTypeComparison('currency', condition.value.type);
          }
          const expectedCurrency = condition.value.value;
          return F.pipe(
            validateEqualityOperator(condition.operator, 'currency'),
            E.map(
              (operator): ConditionEvaluator =>
                facts =>
                  E.right(
                    compareEquality(
                      facts.currency === expectedCurrency,
                      operator,
                    ),
                  ),
            ),
          );
        }
        case 'source-account': {
          if (condition.value.type !== 'account') {
            return invalidTypeComparison('account', condition.value.type);
          }
          const expectedAccount = condition.value.value;
          const missingContextError = E.left(
            new Error(
              `Condition requires source-account, but no reduced lot context is available`,
            ),
          );
          return F.pipe(
            validateEqualityOperator(condition.operator, 'account'),
            E.map(
              (operator): ConditionEvaluator =>
                facts =>
                  facts.context !== 'reduction'
                    ? missingContextError
                    : E.right(
                        compareEquality(
                          facts.sourceAccount === expectedAccount,
                          operator,
                        ),
                      ),
            ),
          );
        }
        case 'source-currency': {
          if (condition.value.type !== 'currency') {
            return invalidTypeComparison('currency', condition.value.type);
          }
          const expectedCurrency = condition.value.value;
          const missingContextError = E.left(
            new Error(
              `Condition requires source-currency, but no reduced lot context is available`,
            ),
          );
          return F.pipe(
            validateEqualityOperator(condition.operator, 'currency'),
            E.map(
              (operator): ConditionEvaluator =>
                facts =>
                  facts.context !== 'reduction'
                    ? missingContextError
                    : E.right(
                        compareEquality(
                          facts.sourceCurrency === expectedCurrency,
                          operator,
                        ),
                      ),
            ),
          );
        }
        case 'acquisition-date': {
          if (condition.value.type !== 'date') {
            return invalidTypeComparison('date', condition.value.type);
          }
          const expectedTimestamp = condition.value.value.getTime();
          const missingContextError = E.left(
            new Error(
              `Condition requires acquisition-date, but no reduced lot context is available`,
            ),
          );
          return E.right(facts =>
            facts.context !== 'reduction'
              ? missingContextError
              : E.right(
                  compareTimestamps(
                    facts.acquisitionDate.getTime(),
                    expectedTimestamp,
                    condition.operator,
                  ),
                ),
          );
        }
        case 'holding-period': {
          if (condition.value.type !== 'duration') {
            return invalidTypeComparison('duration', condition.value.type);
          }
          const expectedDuration = condition.value.value;
          const missingContextError = E.left(
            new Error(
              `Condition requires holding-period, but no reduced lot context is available`,
            ),
          );
          return E.right(facts =>
            facts.context !== 'reduction'
              ? missingContextError
              : E.right(
                  compareNumbers(
                    facts.holdingPeriod,
                    expectedDuration,
                    condition.operator,
                  ),
                ),
          );
        }
        case 'tag': {
          if (condition.value.type !== 'string') {
            return invalidTypeComparison('string', condition.value.type);
          }
          const expectedTag = condition.value.value;
          const missingContextError = E.left(
            new Error(
              `Condition requires tag, but no reduced lot context is available`,
            ),
          );
          return F.pipe(
            validateEqualityOperator(condition.operator, 'string'),
            E.map(
              (operator): ConditionEvaluator =>
                facts =>
                  facts.context !== 'reduction'
                    ? missingContextError
                    : E.right(
                        compareEquality(
                          facts.tags.includes(expectedTag),
                          operator,
                        ),
                      ),
            ),
          );
        }
        default: {
          return E.left(
            new Error(
              `Unknown account-choice attribute: ${condition.attribute}`,
            ),
          );
        }
      }
    }
    default: {
      return E.left(
        new Error(
          `Invalid account-choice condition ${(condition as ConditionExpression).type}`,
        ),
      );
    }
  }
}

function validateEqualityOperator(
  operator: ComparisonOperator,
  type: string,
): E.Either<Error, EqualityOperator> {
  switch (operator) {
    case 'is':
    case '==':
    case 'is not':
    case '!=':
      return E.right(operator);
    default:
      return invalidOrderComparison(type);
  }
}

function compareEquality(equal: boolean, operator: EqualityOperator): boolean {
  switch (operator) {
    case 'is':
    case '==':
      return equal;
    case 'is not':
    case '!=':
      return !equal;
  }
}

function compareNumbers(
  actual: ExactNumberType,
  expected: ExactNumberType,
  operator: ComparisonOperator,
): boolean {
  switch (operator) {
    case 'is':
    case '==':
      return actual.eq(expected);
    case 'is not':
    case '!=':
      return !actual.eq(expected);
    case '<':
      return actual.lt(expected);
    case '<=':
      return actual.lte(expected);
    case '>':
      return actual.gt(expected);
    case '>=':
      return actual.gte(expected);
  }
}

function compareTimestamps(
  actual: number,
  expected: number,
  operator: ComparisonOperator,
): boolean {
  switch (operator) {
    case 'is':
    case '==':
      return actual === expected;
    case 'is not':
    case '!=':
      return actual !== expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
  }
}

function invalidTypeComparison(
  actualType: string,
  expectedType: string,
): E.Either<Error, never> {
  return E.left(
    new Error(
      `Cannot compare account-choice values of types '${actualType}' and '${expectedType}'`,
    ),
  );
}

function invalidOrderComparison(type: string): E.Either<Error, never> {
  return E.left(
    new Error(`Ordered comparison is not valid for account-choice ${type}`),
  );
}
