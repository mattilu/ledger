import { dirname, isAbsolute, join } from 'node:path';

import { ExactNumberType } from 'exactnumber';
import { either as E, function as F, readonlyArray as A } from 'fp-ts';
import { readFile } from 'fs/promises';
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
  const contents = await read(filePath);
  if (E.isLeft(contents)) {
    return E.left(
      new LoadError(
        contents.left.message,
        ctx.stackTrace.length > 0
          ? ctx.stackTrace[0]
          : { filePath, row: 0, col: 0 },
        ctx.stackTrace,
        { cause: contents.left },
      ),
    );
  }
  const result = parse(contents.right);

  if (E.isLeft(result)) {
    return E.left(
      new LoadError(
        result.left.message,
        makeSourceContext(filePath, result.left.srcPos),
        ctx.stackTrace,
        { cause: result.left },
      ),
    );
  }

  ctx.loadedMap.set(filePath, ctx.stackTrace);

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

  for (const directive of result.right.directives) {
    const meta = makeMeta(directive);
    if (E.isLeft(meta)) {
      return meta;
    }

    switch (directive.type) {
      case 'balance': {
        const date = makeDate(directive);
        if (E.isLeft(date)) {
          return date;
        }
        directives.push({
          type: 'balance',
          date: date.right,
          meta: meta.right,
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
        break;
      }
      case 'close': {
        const date = makeDate(directive);
        if (E.isLeft(date)) {
          return date;
        }
        directives.push({
          type: 'close',
          date: date.right,
          meta: meta.right,
          account: directive.account,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
          optionMap: ctx.optionMap,
        });
        break;
      }
      case 'commodity':
      case 'currency': {
        const currencyValue = currencyMap.get(directive.currency);
        if (currencyValue !== undefined) {
          return E.left(
            new LoadError(
              `Currency ${directive.currency} already defined ` +
                `(at ${formatSourceContext([currencyValue.srcCtx])})`,
              makeSourceContext(filePath, directive.srcPos),
              ctx.stackTrace,
            ),
          );
        }

        const date = makeDate(directive);
        if (E.isLeft(date)) {
          return date;
        }

        currencyMap.set(directive.currency, {
          type: 'currency',
          date: date.right,
          currency: directive.currency,
          meta: meta.right,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
          optionMap: ctx.optionMap,
        });
        break;
      }
      case 'load': {
        const toLoad = makeRelativePath(filePath, directive.path);
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
        const loadResult = await doLoad(toLoad, directives, currencyMap, {
          ...ctx,
          stackTrace: [
            makeSourceContext(filePath, directive.srcPos),
            ...ctx.stackTrace,
          ],
        });
        if (E.isLeft(loadResult)) {
          return loadResult;
        }
        break;
      }
      case 'open': {
        const date = makeDate(directive);
        if (E.isLeft(date)) {
          return date;
        }
        directives.push({
          type: 'open',
          date: date.right,
          meta: meta.right,
          account: directive.account,
          currencies: directive.currencies,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
          optionMap: ctx.optionMap,
        });
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
        break;
      case 'transaction': {
        const date = makeDate(directive);
        if (E.isLeft(date)) {
          return date;
        }
        const postings: E.Either<LoadError, readonly Posting[]> = F.pipe(
          directive.postings,
          A.traverse(E.Applicative)(posting =>
            F.pipe(
              makeMeta({ meta: posting.meta, srcPos: directive.srcPos }),
              E.map(
                (meta: Metadata): Posting => ({
                  account: posting.account,
                  flag: posting.flag ?? directive.flag,
                  amount: posting.amount
                    ? evaluateAmount(posting.amount)
                    : null,
                  costSpec: posting.costSpec
                    ? evaluateCostSpec(posting.costSpec)
                    : null,
                  meta,
                }),
              ),
            ),
          ),
        );
        if (E.isLeft(postings)) {
          return postings;
        }

        directives.push({
          type: 'transaction',
          date: date.right,
          meta: meta.right,
          description: directive.description,
          flag: directive.flag,
          postings: postings.right,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
          optionMap: ctx.optionMap,
        });
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

function evaluateCostSpec(costSpec: CostSpec): EvaluatedCostSpec {
  return {
    kind: costSpec.kind,
    amounts: costSpec.amounts.map(evaluateAmount),
  };
}
