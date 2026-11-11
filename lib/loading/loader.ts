import { dirname, isAbsolute, join } from 'node:path';

import { ExactNumber, ExactNumberType } from 'exactnumber';
import { either as E, function as F, readonlyArray as A } from 'fp-ts';
import { glob, readFile } from 'fs/promises';
import { Map as ImmutableMap } from 'immutable';
import { resolve } from 'path';

import { parseNormalBalanceSide } from '../core/account.js';
import { Amount } from '../core/amount.js';
import {
  CanonicalAmountConverter,
  DefaultSignConvention,
  parseSignConvention,
  SignConvention,
} from '../core/sign-convention.js';
import { parse } from '../parsing/parser.js';
import { SourcePosition } from '../parsing/source-position.js';
import { AmountSpec } from '../parsing/spec/amount.js';
import {
  ConditionExpression as ConditionExpressionSpec,
  ConditionLiteral as ConditionLiteralSpec,
} from '../parsing/spec/condition.js';
import { DateSpec } from '../parsing/spec/date.js';
import { DirectiveCommonSpec } from '../parsing/spec/directive.js';
import {
  AccountChoiceRule as AccountChoiceRuleSpec,
  AccountRuleDirectiveSpec,
} from '../parsing/spec/directives/account-rule.js';
import {
  AccountChoicePostingSpec,
  AccountChoiceSpec,
  AccountPostingSpec,
  CostSpec,
  PostingSpec,
  TransactionDirectiveSpec,
} from '../parsing/spec/directives/transaction.js';
import { Expression } from '../parsing/spec/expression.js';
import { MetadataSpec } from '../parsing/spec/metadata.js';
import { takeWhile, tee, zip } from '../utils/iter.js';
import { Directive } from './directive.js';
import {
  AccountChoiceRule,
  AccountRuleDirective,
  ConditionExpression,
  ConditionLiteral,
} from './directives/account-choice.js';
import { BalanceDirective, BalanceEntry } from './directives/balance.js';
import { CloseDirective } from './directives/close.js';
import { CurrencyDirective } from './directives/currency.js';
import { OpenDirective } from './directives/open.js';
import {
  AccountChoice,
  AccountChoicePosting,
  AccountPosting,
  CostSpec as EvaluatedCostSpec,
  TransactionDirective,
} from './directives/transaction.js';
import { LoadError } from './error.js';
import { AccountMap, Ledger } from './ledger.js';
import { Metadata, MetadataValue } from './metadata.js';
import { makeSourceContext, SourceContext } from './source-context.js';

type PartialOpenDirective = Omit<OpenDirective, 'accountMap'>;
type PartialCloseDirective = Omit<CloseDirective, 'accountMap'>;

type PartialBalanceEntry = Omit<BalanceEntry, 'normalBalanceSide'>;
type PartialBalanceDirective = Omit<BalanceDirective, 'balances'> & {
  readonly balances: readonly PartialBalanceEntry[];
};

type PartialAccountPosting = Omit<AccountPosting, 'normalBalanceSide'>;
type PartialAccountChoicePosting = AccountChoicePosting;
type PartialPosting = PartialAccountPosting | PartialAccountChoicePosting;
type PartialTransactionDirective = Omit<TransactionDirective, 'postings'> & {
  readonly postings: readonly PartialPosting[];
};

type PartialDirective =
  | Exclude<
      Directive,
      OpenDirective | CloseDirective | BalanceDirective | TransactionDirective
    >
  | PartialOpenDirective
  | PartialCloseDirective
  | PartialBalanceDirective
  | PartialTransactionDirective;

export type LoadOptions = {
  /**
   * If specified, instructs `load` to only process directives until this
   * function yields `false` or completes.
   *
   * The resulting directives will be the same as if the filtering was applied
   * after the whole file is loaded, but `accountMap` will reflect the state
   * past the last taken directive, which can be different.
   *
   * This uses iterables instead of a predicate, to allow callers to look ahead
   * before making a decision, without forcing the whole evaluation.
   *
   * @param directives An iterable of directives to test, date-ordered.
   * @returns An iterable of booleans.
   */
  readonly takeWhile?: (directives: Iterable<Directive>) => Iterable<boolean>;
};

/**
 * Loads a ledger from a file.
 *
 * @param filePath Path to the file to load.
 * @returns Either a LoadError, or the loaded Ledger.
 */
export async function load(
  filePath: string,
  options?: LoadOptions,
): Promise<E.Either<LoadError, Ledger>> {
  const directives: PartialDirective[] = [];
  const currencyMap = new Map<string, CurrencyDirective>();
  const accountRuleMap = new Map<string, AccountRuleDirective>();
  const context: LoadContext = {
    stackTrace: [],
    loadedMap: new Map(),
    defaultTimezone: 'Z',
    signConvention: DefaultSignConvention,
    optionMap: ImmutableMap(),
  };

  return F.pipe(
    await doLoad(filePath, directives, currencyMap, accountRuleMap, context),
    E.bindTo('ctx'),
    E.bind('normalized', () => normalizeDirectives(directives, options)),
    E.map(
      ({ ctx, normalized }): Ledger => ({
        directives: normalized.directives,
        currencyMap: ImmutableMap(currencyMap),
        accountMap: normalized.accountMap,
        accountRuleMap: ImmutableMap(accountRuleMap),
        signConvention: ctx.signConvention,
      }),
    ),
  );
}

interface LoadContext {
  // Current stack trace, most recent file is first.
  readonly stackTrace: readonly SourceContext[];
  // Map from path to stack trace that lead to loading it.
  // Note this is mutable, we need it to propagate across calls.
  readonly loadedMap: Map<string, readonly SourceContext[]>;
  // Current default timezone.
  readonly defaultTimezone: string;
  // Current sign convention.
  readonly signConvention: SignConvention;
  // Current options.
  readonly optionMap: ImmutableMap<string, string>;
}

type MakeDate = (directive: {
  readonly date: DateSpec;
  readonly srcPos: SourcePosition;
}) => E.Either<LoadError, Date>;

type MakeMeta = (directive: {
  readonly meta: MetadataSpec;
  readonly srcPos: SourcePosition;
}) => E.Either<LoadError, Metadata>;

/**
 * Parses a file and collects its directives.
 *
 * @param filePath Path of the file to load.
 * @param directives Output array to collect directives into.
 * @param ctx Current context for the load
 * @returns Either a LoadError, or the final state of LoadContext.
 */
async function doLoad(
  filePath: string,
  directives: PartialDirective[],
  currencyMap: Map<string, CurrencyDirective>,
  accountRuleMap: Map<string, AccountRuleDirective>,
  ctx: LoadContext,
): Promise<E.Either<LoadError, LoadContext>> {
  ctx.loadedMap.set(filePath, ctx.stackTrace);

  const parsed = F.pipe(
    await read(filePath),
    E.mapLeft(
      err =>
        new LoadError(
          err.message,
          ctx.stackTrace.length > 0
            ? ctx.stackTrace[0]
            : { filePath, row: 0, col: 0 },
          ctx.stackTrace,
          { cause: err },
        ),
    ),
    E.chain(contents =>
      F.pipe(
        contents,
        parse,
        E.mapLeft(
          err =>
            new LoadError(
              err.message,
              makeSourceContext(filePath, err.srcPos),
              ctx.stackTrace,
              { cause: err },
            ),
        ),
      ),
    ),
  );
  if (E.isLeft(parsed)) {
    return parsed;
  }

  const makeDate: MakeDate = directive => {
    const dateStr = directive.date.time
      ? `${directive.date.date}T${directive.date.time}${directive.date.timezone ?? ctx.defaultTimezone}`
      : directive.date.date;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return E.left(
        new LoadError(
          `Invalid date '${dateStr}'`,
          makeSourceContext(filePath, directive.srcPos),
          ctx.stackTrace,
        ),
      );
    }
    return E.right(date);
  };

  const makeMeta: MakeMeta = directive => {
    const entries: [string, MetadataValue][] = [];
    for (const [key, value] of directive.meta.entries()) {
      if (value.type === 'date') {
        const date = makeDate({ date: value.value, srcPos: directive.srcPos });
        if (E.isLeft(date)) {
          return date;
        }
        entries.push([key, { type: 'date', value: date.right }]);
      } else if (value.type === 'number') {
        entries.push([
          key,
          { type: 'number', value: evaluateExpression(value.value) },
        ]);
      } else if (value.type === 'amount') {
        entries.push([
          key,
          { type: 'amount', value: evaluateAmount(value.value) },
        ]);
      } else {
        entries.push([key, value]);
      }
    }
    return E.right(ImmutableMap(entries));
  };

  for (const directive of parsed.right.directives) {
    let result: E.Either<LoadError, unknown>;
    switch (directive.type) {
      case 'account-rule': {
        result = loadAccountRule(
          directive,
          filePath,
          ctx,
          accountRuleMap,
          ctx.optionMap,
          makeDate,
          makeMeta,
        );
        break;
      }
      case 'balance': {
        result = F.pipe(
          E.Do,
          E.bind('meta', () => makeMeta(directive)),
          E.bind('date', () => makeDate(directive)),
          E.map(({ date, meta }) => {
            directives.push({
              type: 'balance',
              date: date,
              meta: meta,
              balances: directive.balances.map(balance => ({
                account: balance.account,
                amount: evaluateAmount(balance.amount),
                approx:
                  balance.approx === null
                    ? null
                    : evaluateExpression(balance.approx),
              })),
              signConvention: ctx.signConvention,
              srcCtx: makeSourceContext(filePath, directive.srcPos),
              optionMap: ctx.optionMap,
            });
          }),
        );
        break;
      }
      case 'close': {
        result = F.pipe(
          E.Do,
          E.bind('meta', () => makeMeta(directive)),
          E.bind('date', () => makeDate(directive)),
          E.map(({ date, meta }) => {
            directives.push({
              type: 'close',
              date: date,
              meta: meta,
              account: directive.account,
              srcCtx: makeSourceContext(filePath, directive.srcPos),
              optionMap: ctx.optionMap,
            });
          }),
        );
        break;
      }
      case 'commodity':
      case 'currency': {
        result = F.pipe(
          E.Do,
          E.chainFirst(() =>
            F.pipe(currencyMap.get(directive.currency), currencyValue =>
              currencyValue !== undefined
                ? E.left(
                    new LoadError(
                      `Currency ${directive.currency} already defined ` +
                        `(at ${formatSourceContext([currencyValue.srcCtx])})`,
                      makeSourceContext(filePath, directive.srcPos),
                      ctx.stackTrace,
                    ),
                  )
                : E.right(undefined),
            ),
          ),
          E.bind('meta', () => makeMeta(directive)),
          E.bind('date', () => makeDate(directive)),
          E.map(({ date, meta }) => {
            currencyMap.set(directive.currency, {
              type: 'currency',
              date: date,
              currency: directive.currency,
              meta: meta,
              srcCtx: makeSourceContext(filePath, directive.srcPos),
              optionMap: ctx.optionMap,
            });
          }),
        );
        break;
      }
      case 'load': {
        const path = makeRelativePath(filePath, directive.path);
        const paths = path.includes('*')
          ? (await Array.fromAsync(glob(path))).toSorted((a, b) =>
              a.localeCompare(b),
            )
          : [path];

        for (const toLoad of paths) {
          const loadedFrom = ctx.loadedMap.get(toLoad);
          if (loadedFrom !== undefined) {
            return E.left(
              new LoadError(
                `Circular load dependency detected: ${toLoad} was already ` +
                  `loaded (at ${formatSourceContext(loadedFrom)})`,
                makeSourceContext(filePath, directive.srcPos),
                ctx.stackTrace,
              ),
            );
          }
          result = await doLoad(
            toLoad,
            directives,
            currencyMap,
            accountRuleMap,
            {
              ...ctx,
              stackTrace: [
                makeSourceContext(filePath, directive.srcPos),
                ...ctx.stackTrace,
              ],
            },
          );
          if (E.isLeft(result)) {
            return result;
          }
        }

        result = E.of(undefined);
        break;
      }
      case 'open': {
        result = F.pipe(
          E.Do,
          E.bind('meta', () => makeMeta(directive)),
          E.bind('date', () => makeDate(directive)),
          E.bind('normalBalanceSide', ({ meta }) => {
            const normalBalance = meta.get('normal-balance');
            if (normalBalance === undefined) {
              return E.of(undefined);
            }
            if (normalBalance.type !== 'string') {
              return E.left(
                new LoadError(
                  'Invalid normal-balance metadata type',
                  makeSourceContext(filePath, directive.srcPos),
                  ctx.stackTrace,
                ),
              );
            }
            return F.pipe(
              parseNormalBalanceSide(normalBalance.value),
              E.mapLeft(
                err =>
                  new LoadError(
                    `Invalid normal-balance value '${normalBalance.value}': ${err}`,
                    makeSourceContext(filePath, directive.srcPos),
                    ctx.stackTrace,
                  ),
              ),
            );
          }),
          E.map(({ date, meta, normalBalanceSide }) => {
            directives.push({
              type: 'open',
              date: date,
              meta: meta,
              account: directive.account,
              currencies: directive.currencies,
              normalBalanceSide: normalBalanceSide,
              srcCtx: makeSourceContext(filePath, directive.srcPos),
              optionMap: ctx.optionMap,
            });
          }),
        );
        break;
      }
      case 'option': {
        switch (directive.optionName) {
          case 'default-timezone':
            ctx = { ...ctx, defaultTimezone: directive.optionValue };
            break;
          case 'sign-convention': {
            const convention = parseSignConvention(directive.optionValue);
            if (E.isLeft(convention)) {
              return E.left(
                new LoadError(
                  `Invalid sign-convention option '${directive.optionValue}': ${convention.left}`,
                  makeSourceContext(filePath, directive.srcPos),
                  ctx.stackTrace,
                ),
              );
            }
            ctx = { ...ctx, signConvention: convention.right };
            break;
          }
        }
        ctx = {
          ...ctx,
          optionMap: ctx.optionMap.set(
            directive.optionName,
            directive.optionValue,
          ),
        };
        result = E.of(undefined);
        break;
      }
      case 'price': {
        result = F.pipe(
          E.Do,
          E.bind('meta', () => makeMeta(directive)),
          E.bind('date', () => makeDate(directive)),
          E.map(({ date, meta }) => {
            directives.push({
              type: 'price',
              date: date,
              meta: meta,
              currency: directive.currency,
              price: evaluateAmount(directive.price),
              srcCtx: makeSourceContext(filePath, directive.srcPos),
              optionMap: ctx.optionMap,
            });
          }),
        );
        break;
      }
      case 'transaction': {
        result = F.pipe(
          E.Do,
          E.bind('meta', () => makeMeta(directive)),
          E.bind('date', () => makeDate(directive)),
          E.bind('postings', () =>
            F.pipe(
              directive.postings,
              A.traverse(E.Applicative)(posting =>
                evaluatePostingSpec(directive, posting, makeDate, makeMeta),
              ),
            ),
          ),
          E.map(({ date, meta, postings }) => {
            directives.push({
              type: 'transaction',
              date: date,
              dateSpec: directive.date,
              meta: meta,
              description: directive.description,
              flag: directive.flag,
              postings: postings,
              signConvention: ctx.signConvention,
              srcCtx: makeSourceContext(filePath, directive.srcPos),
              optionMap: ctx.optionMap,
            });
          }),
        );
        break;
      }
      default: {
        const d = directive as DirectiveCommonSpec<string>;
        return E.left(
          new LoadError(
            `${d.type} directive not implemented yet`,
            makeSourceContext(filePath, d.srcPos),
            ctx.stackTrace,
          ),
        );
      }
    }

    if (E.isLeft(result)) {
      return result;
    }
  }

  return E.right(ctx);
}

function evaluatePostingSpec(
  transaction: TransactionDirectiveSpec,
  posting: PostingSpec,
  makeDate: MakeDate,
  makeMeta: MakeMeta,
): E.Either<LoadError, PartialPosting> {
  return isAccountChoicePosting(posting)
    ? evaluateAccountChoicePostingSpec(transaction, posting, makeDate, makeMeta)
    : evaluateAccountPostingSpec(transaction, posting, makeDate, makeMeta);
}

function evaluateAccountChoicePostingSpec(
  transaction: TransactionDirectiveSpec,
  posting: AccountChoicePostingSpec,
  makeDate: MakeDate,
  makeMeta: MakeMeta,
): E.Either<LoadError, PartialAccountChoicePosting> {
  return F.pipe(
    evaluateAccountChoiceSpec(transaction, posting.account, makeDate),
    E.flatMap(account =>
      F.pipe(
        makeMeta({ meta: posting.meta, srcPos: transaction.srcPos }),
        E.map(meta => ({
          account,
          flag: posting.flag ?? transaction.flag,
          meta,
        })),
      ),
    ),
  );
}

function evaluateAccountChoiceSpec(
  transaction: TransactionDirectiveSpec,
  accountChoice: AccountChoiceSpec,
  makeDate: MakeDate,
): E.Either<LoadError, AccountChoice> {
  if (accountChoice.type === 'ref') {
    return E.right(accountChoice);
  }
  return F.pipe(
    evaluateAccountChoiceRuleSpecs(
      accountChoice.rules,
      transaction.srcPos,
      makeDate,
    ),
    E.map(rules => ({ type: 'inline' as const, rules })),
  );
}

function evaluateAccountPostingSpec(
  transaction: TransactionDirectiveSpec,
  posting: AccountPostingSpec,
  makeDate: MakeDate,
  makeMeta: MakeMeta,
): E.Either<LoadError, PartialAccountPosting> {
  return F.pipe(
    E.Do,
    E.bind('costSpec', () =>
      posting.costSpec === null
        ? E.right(null)
        : evaluateCostSpec(posting.costSpec, date =>
            makeDate({ date, srcPos: transaction.srcPos }),
          ),
    ),
    E.bind('meta', () =>
      makeMeta({ meta: posting.meta, srcPos: transaction.srcPos }),
    ),
    E.map(({ costSpec, meta }) => ({
      account: posting.account,
      flag: posting.flag ?? transaction.flag,
      amount: posting.amount === null ? null : evaluateAmount(posting.amount),
      costSpec,
      priceSpec:
        posting.priceSpec === null
          ? null
          : {
              kind: posting.priceSpec.kind,
              amount: evaluateAmount(posting.priceSpec.amount),
            },
      meta,
    })),
  );
}

function loadAccountRule(
  directive: AccountRuleDirectiveSpec,
  filePath: string,
  ctx: LoadContext,
  accountRuleMap: Map<string, AccountRuleDirective>,
  optionMap: ImmutableMap<string, string>,
  makeDate: MakeDate,
  makeMeta: MakeMeta,
): E.Either<LoadError, void> {
  const srcCtx = makeSourceContext(filePath, directive.srcPos);
  if (directive.name.trim().length === 0) {
    return E.left(
      new LoadError(
        'Account rule name cannot be empty',
        srcCtx,
        ctx.stackTrace,
      ),
    );
  }
  const existing = accountRuleMap.get(directive.name);
  if (existing !== undefined) {
    return E.left(
      new LoadError(
        `Account rule '${directive.name}' is already defined (at ${formatSourceContext([existing.srcCtx])})`,
        srcCtx,
        ctx.stackTrace,
      ),
    );
  }
  return F.pipe(
    E.Do,
    E.bind('rules', () =>
      evaluateAccountChoiceRuleSpecs(
        directive.rules,
        directive.srcPos,
        makeDate,
      ),
    ),
    E.bind('meta', () => makeMeta(directive)),
    E.map(({ rules, meta }) => {
      accountRuleMap.set(directive.name, {
        type: 'account-rule',
        name: directive.name,
        rules,
        meta,
        srcCtx,
        optionMap,
      });
    }),
  );
}

function evaluateAccountChoiceRuleSpecs(
  rules: readonly AccountChoiceRuleSpec[],
  srcPos: SourcePosition,
  makeDate: MakeDate,
): E.Either<LoadError, readonly AccountChoiceRule[]> {
  const evaluated: AccountChoiceRule[] = [];
  for (const rule of rules) {
    if (rule.type === 'otherwise') {
      evaluated.push(rule);
      continue;
    }
    const condition = evaluateConditionExpressionSpec(
      rule.condition,
      srcPos,
      makeDate,
    );
    if (E.isLeft(condition)) {
      return condition;
    }
    evaluated.push({
      type: 'when',
      condition: condition.right,
      account: rule.account,
    });
  }
  return E.right(evaluated);
}

function evaluateConditionExpressionSpec(
  expression: ConditionExpressionSpec,
  srcPos: SourcePosition,
  makeDate: MakeDate,
): E.Either<LoadError, ConditionExpression> {
  if (expression.type === 'comparison') {
    const value = evaluateConditionLiteralSpec(
      expression.value,
      srcPos,
      makeDate,
    );
    return F.pipe(
      value,
      E.map(evaluated => ({
        type: 'comparison' as const,
        attribute: expression.attribute,
        operator: expression.operator,
        value: evaluated,
      })),
    );
  }
  if (expression.type === 'not') {
    return F.pipe(
      evaluateConditionExpressionSpec(expression.expr, srcPos, makeDate),
      E.map(expr => ({ type: 'not' as const, expression: expr })),
    );
  }
  const lhs = evaluateConditionExpressionSpec(expression.lhs, srcPos, makeDate);
  if (E.isLeft(lhs)) {
    return lhs;
  }
  return F.pipe(
    evaluateConditionExpressionSpec(expression.rhs, srcPos, makeDate),
    E.map(rhs => ({
      type: expression.type,
      lhs: lhs.right,
      rhs,
    })),
  );
}

function evaluateConditionLiteralSpec(
  literal: ConditionLiteralSpec,
  srcPos: SourcePosition,
  makeDate: MakeDate,
): E.Either<LoadError, ConditionLiteral> {
  switch (literal.type) {
    case 'identifier':
    case 'string':
    case 'account':
    case 'currency':
      return E.right(literal);
    case 'number':
      return E.right({
        type: 'number',
        value: evaluateExpression(literal.value),
      });
    case 'duration':
      return E.right({
        type: 'duration',
        value: ExactNumber(literal.value),
        unit: literal.unit,
      });
    case 'amount':
      return E.right({
        type: 'amount',
        value: evaluateAmount(literal.value),
      });
    case 'date':
      return F.pipe(
        makeDate({ date: literal.value, srcPos }),
        E.map(value => ({ type: 'date' as const, value })),
      );
  }
}

function isAccountChoicePosting(
  postingSpec: PostingSpec,
): postingSpec is AccountChoicePostingSpec {
  return typeof postingSpec.account !== 'string';
}

function isOrdinaryPartialPosting(
  posting: PartialPosting,
): posting is PartialAccountPosting {
  return typeof posting.account === 'string';
}

type NormalizeResult = {
  readonly directives: readonly Directive[];
  readonly accountMap: AccountMap;
};

function normalizeDirectives(
  directives: readonly PartialDirective[],
  options?: LoadOptions,
): E.Either<LoadError, NormalizeResult> {
  const sortedDirectives = [...directives].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  function* generator(): Generator<[Directive, AccountMap], void, unknown> {
    let accountMap: AccountMap = ImmutableMap();
    const converter: CanonicalAmountConverter = new CanonicalAmountConverter({
      get(account) {
        return accountMap.get(account)?.open?.normalBalanceSide;
      },
    });

    for (const directive of sortedDirectives) {
      switch (directive.type) {
        case 'open': {
          // Note, we intentionally don't keep a previous `close`
          accountMap = accountMap.set(directive.account, {
            open: directive,
          });
          converter.clearCache();
          yield [{ ...directive, accountMap }, accountMap];
          break;
        }
        case 'close':
          accountMap = accountMap.update(directive.account, (state = {}) => ({
            ...state,
            close: directive,
          }));
          yield [{ ...directive, accountMap }, accountMap];
          break;
        case 'balance':
          yield [
            {
              ...directive,
              balances: directive.balances.map(balance => ({
                ...balance,
                amount: converter.convert(
                  balance.amount,
                  directive.signConvention,
                  balance.account,
                ),
                normalBalanceSide: converter.getNormalBalanceSide(
                  balance.account,
                ),
              })),
            },
            accountMap,
          ];
          break;
        case 'transaction': {
          yield [
            {
              ...directive,
              postings: directive.postings.map(posting => {
                if (!isOrdinaryPartialPosting(posting)) {
                  return posting;
                }
                return {
                  ...posting,
                  amount:
                    posting.amount === null
                      ? null
                      : converter.convert(
                          posting.amount,
                          directive.signConvention,
                          posting.account,
                        ),
                  normalBalanceSide: converter.getNormalBalanceSide(
                    posting.account,
                  ),
                };
              }),
            },
            accountMap,
          ];
          break;
        }
        default:
          yield [directive, accountMap];
          break;
      }
    }
  }

  function collect(
    values: Iterable<[Directive, AccountMap]>,
  ): E.Either<LoadError, NormalizeResult> {
    let accountMap: AccountMap = ImmutableMap();
    const directives: Directive[] = [];
    for (const [directive, accMap] of values) {
      directives.push(directive);
      accountMap = accMap;
    }
    return E.right({ directives, accountMap });
  }

  if (!options?.takeWhile) {
    return collect(generator());
  }

  // We need to tee generator to allow it being consumed twice.
  const [gen, genForFilter] = tee(generator());
  return collect(
    takeWhile(
      zip(gen, options.takeWhile(genForFilter.map(([directive]) => directive))),
      ([, keep]) => keep,
    ).map(([directive]) => directive),
  );
}

async function read(filePath: string): Promise<E.Either<Error, string>> {
  try {
    return E.right(await readFile(resolve(filePath), { encoding: 'utf-8' }));
  } catch (e) {
    if (e instanceof Error) {
      return E.left(e);
    }
    throw e;
  }
}

function makeRelativePath(rootPath: string, path: string): string {
  if (isAbsolute(path)) {
    return path;
  }
  return join(dirname(rootPath), path);
}

function formatSourceContext(stackTrace: readonly SourceContext[]) {
  return stackTrace.length > 0
    ? `${stackTrace[0].filePath}:${stackTrace[0].row}`
    : '<main>';
}

function evaluateExpression(expression: Expression): ExactNumberType {
  switch (expression.type) {
    case 'literal':
      return expression.value;
    case 'unary': {
      const expr = evaluateExpression(expression.expr);
      return expression.op === '+' ? expr : expr.neg();
    }
    case 'binary': {
      const expr1 = evaluateExpression(expression.expr1);
      const expr2 = evaluateExpression(expression.expr2);
      switch (expression.op) {
        case '+':
          return expr1.add(expr2);
        case '-':
          return expr1.sub(expr2);
        case '*':
          return expr1.mul(expr2);
        case '/':
          return expr1.div(expr2);
      }
    }
  }
}

function evaluateAmount(amount: AmountSpec): Amount {
  return new Amount(evaluateExpression(amount.amount), amount.currency);
}

function evaluateCostSpec(
  costSpec: CostSpec,
  makeDate: (date: DateSpec) => E.Either<LoadError, Date>,
): E.Either<LoadError, EvaluatedCostSpec> {
  return F.pipe(
    costSpec.dates,
    A.traverse(E.Applicative)(date => makeDate(date)),
    E.map(dates => ({
      kind: costSpec.kind,
      amounts: costSpec.amounts.map(evaluateAmount),
      currencies: costSpec.currencies,
      dateSpecs: costSpec.dates,
      dates: dates.slice(),
      tags: costSpec.tags,
    })),
  );
}
