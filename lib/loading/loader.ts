import { dirname, isAbsolute, join } from 'node:path';

import { ExactNumberType } from 'exactnumber';
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
import { DateSpec } from '../parsing/spec/date.js';
import { DirectiveCommonSpec } from '../parsing/spec/directive.js';
import {
  AccountChoicePostingSpec,
  CostSpec,
  PostingSpec,
} from '../parsing/spec/directives/transaction.js';
import { Expression } from '../parsing/spec/expression.js';
import { MetadataSpec } from '../parsing/spec/metadata.js';
import { takeWhile, tee, zip } from '../utils/iter.js';
import { Directive } from './directive.js';
import { BalanceDirective, BalanceEntry } from './directives/balance.js';
import { CloseDirective } from './directives/close.js';
import { CurrencyDirective } from './directives/currency.js';
import { OpenDirective } from './directives/open.js';
import {
  CostSpec as EvaluatedCostSpec,
  Posting,
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

type PartialPosting = Omit<Posting, 'normalBalanceSide'>;
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
  const context: LoadContext = {
    stackTrace: [],
    loadedMap: new Map(),
    defaultTimezone: 'Z',
    signConvention: DefaultSignConvention,
    optionMap: ImmutableMap(),
  };

  return F.pipe(
    await doLoad(filePath, directives, currencyMap, context),
    E.bindTo('ctx'),
    E.bind('normalized', () => normalizeDirectives(directives, options)),
    E.map(
      ({ ctx, normalized }): Ledger => ({
        directives: normalized.directives,
        currencyMap: ImmutableMap(currencyMap),
        accountMap: normalized.accountMap,
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

  const makeDate = (directive: {
    readonly date: DateSpec;
    readonly srcPos: SourcePosition;
  }): E.Either<LoadError, Date> => {
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

  const makeMeta = (directive: {
    readonly meta: MetadataSpec;
    readonly srcPos: SourcePosition;
  }): E.Either<LoadError, Metadata> => {
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
        result = E.left(
          new LoadError(
            'Account rules are not implemented yet',
            makeSourceContext(filePath, directive.srcPos),
            ctx.stackTrace,
          ),
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
          result = await doLoad(toLoad, directives, currencyMap, {
            ...ctx,
            stackTrace: [
              makeSourceContext(filePath, directive.srcPos),
              ...ctx.stackTrace,
            ],
          });
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
              A.traverse(E.Applicative)(posting => {
                if (isAccountChoicePosting(posting)) {
                  return E.left(
                    new LoadError(
                      'Account-choice postings are not implemented yet',
                      makeSourceContext(filePath, directive.srcPos),
                      ctx.stackTrace,
                    ),
                  );
                }
                const account = posting.account;
                return F.pipe(
                  makeMeta({ meta: posting.meta, srcPos: directive.srcPos }),
                  E.bindTo('meta'),
                  E.bind('costSpec', () =>
                    posting.costSpec
                      ? evaluateCostSpec(posting.costSpec, date =>
                          makeDate({ date, srcPos: directive.srcPos }),
                        )
                      : E.right(null),
                  ),
                  E.map(
                    ({ meta, costSpec }): PartialPosting => ({
                      account,
                      flag: posting.flag ?? directive.flag,
                      amount: posting.amount
                        ? evaluateAmount(posting.amount)
                        : null,
                      costSpec,
                      priceSpec: posting.priceSpec
                        ? {
                            kind: posting.priceSpec.kind,
                            amount: evaluateAmount(posting.priceSpec.amount),
                          }
                        : null,
                      meta,
                    }),
                  ),
                );
              }),
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

function isAccountChoicePosting(
  postingSpec: PostingSpec,
): postingSpec is AccountChoicePostingSpec {
  return typeof postingSpec.account !== 'string';
}

type NormalizeResult = {
  readonly directives: readonly Directive[];
  readonly accountMap: AccountMap;
};

function normalizeDirectives(
  directives: PartialDirective[],
  options?: LoadOptions,
): E.Either<LoadError, NormalizeResult> {
  directives.sort((a, b) => a.date.getTime() - b.date.getTime());

  function* generator(): Generator<[Directive, AccountMap], void, unknown> {
    let accountMap: AccountMap = ImmutableMap();
    const converter: CanonicalAmountConverter = new CanonicalAmountConverter({
      get(account) {
        return accountMap.get(account)?.open?.normalBalanceSide;
      },
    });

    for (const directive of directives) {
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
              postings: directive.postings.map(posting => ({
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
              })),
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
