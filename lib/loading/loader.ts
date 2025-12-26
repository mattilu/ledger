import { dirname, isAbsolute, join } from 'node:path';

import { ExactNumberType } from 'exactnumber';
import { either as E, function as F, readonlyArray as A } from 'fp-ts';
import { glob, readFile } from 'fs/promises';
import { Map as ImmutableMap } from 'immutable';
import { resolve } from 'path';

import { Amount } from '../core/amount.js';
import { parse } from '../parsing/parser.js';
import { SourcePosition } from '../parsing/source-position.js';
import { AmountSpec } from '../parsing/spec/amount.js';
import { DateSpec } from '../parsing/spec/date.js';
import { DirectiveCommonSpec } from '../parsing/spec/directive.js';
import { CostSpec } from '../parsing/spec/directives/transaction.js';
import { Expression } from '../parsing/spec/expression.js';
import { MetadataSpec } from '../parsing/spec/metadata.js';
import { Directive } from './directive.js';
import { CurrencyDirective } from './directives/currency.js';
import {
  CostSpec as EvaluatedCostSpec,
  Posting,
} from './directives/transaction.js';
import { LoadError } from './error.js';
import { Ledger } from './ledger.js';
import { Metadata, MetadataValue } from './metadata.js';
import { makeSourceContext, SourceContext } from './source-context.js';

/**
 * Loads a ledger from a file.
 *
 * @param filePath Path to the file to load.
 * @returns Either a LoadError, or the loaded Ledger.
 */
export async function load(
  filePath: string,
): Promise<E.Either<LoadError, Ledger>> {
  const directives: Directive[] = [];
  const currencyMap = new Map<string, CurrencyDirective>();
  const context: LoadContext = {
    stackTrace: [],
    loadedMap: new Map(),
    defaultTimezone: 'Z',
    optionMap: ImmutableMap(),
  };

  return F.pipe(
    await doLoad(filePath, directives, currencyMap, context),
    E.tap(
      F.flow(
        () => directives.sort((a, b) => a.date.getTime() - b.date.getTime()),
        E.right,
      ),
    ),
    E.map(
      (): Ledger => ({
        directives,
        currencyMap: ImmutableMap(currencyMap),
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
  // Current options.
  readonly optionMap: ImmutableMap<string, string>;
}

/**
 * Parses a file and collects its directives.
 *
 * @param filePath Path of the file to load.
 * @param directives Output array to collect directives into.
 * @param ctx Current context for the load
 * @returns Either a LoadError, or void.
 */
async function doLoad(
  filePath: string,
  directives: Directive[],
  currencyMap: Map<string, CurrencyDirective>,
  ctx: LoadContext,
): Promise<E.Either<LoadError, unknown>> {
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
          E.map(({ date, meta }) => {
            directives.push({
              type: 'open',
              date: date,
              meta: meta,
              account: directive.account,
              currencies: directive.currencies,
              srcCtx: makeSourceContext(filePath, directive.srcPos),
              optionMap: ctx.optionMap,
            });
          }),
        );
        break;
      }
      case 'option':
        ctx = {
          ...ctx,
          optionMap: ctx.optionMap.set(
            directive.optionName,
            directive.optionValue,
          ),
        };
        if (directive.optionName === 'default-timezone') {
          ctx = { ...ctx, defaultTimezone: directive.optionValue };
        }
        result = E.of(undefined);
        break;
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
                F.pipe(
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
                    ({ meta, costSpec }): Posting => ({
                      account: posting.account,
                      flag: posting.flag ?? directive.flag,
                      amount: posting.amount
                        ? evaluateAmount(posting.amount)
                        : null,
                      costSpec,
                      meta,
                    }),
                  ),
                ),
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

  return E.right(undefined);
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
