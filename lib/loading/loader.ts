import { dirname, isAbsolute, join } from 'node:path';

import { Either, isLeft, left, map, right, tap } from 'fp-ts/lib/Either.js';
import { flow, pipe } from 'fp-ts/lib/function.js';
import { readFile } from 'fs/promises';
import { Map as ImmutableMap } from 'immutable';
import { resolve } from 'path';

import { parse } from '../parsing/parser.js';
import { SourcePosition } from '../parsing/source-position.js';
import { DateSpec } from '../parsing/spec/date.js';
import { DirectiveCommonSpec } from '../parsing/spec/directive.js';
import { Directive } from './directive.js';
import { LoadError } from './error.js';
import { Ledger } from './ledger.js';
import { makeSourceContext, SourceContext } from './source-context.js';

/**
 * Loads a ledger from a file.
 *
 * @param filePath Path to the file to load.
 * @returns Either a LoadError, or the loaded Ledger.
 */
export async function load(
  filePath: string,
): Promise<Either<LoadError, Ledger>> {
  const directives: Directive[] = [];
  const context: LoadContext = {
    stackTrace: [],
    loadedMap: new Map(),
    defaultTimezone: 'Z',
    optionMap: ImmutableMap(),
  };

  return pipe(
    await doLoad(filePath, directives, context),
    tap(
      flow(
        () => directives.sort((a, b) => a.date.getTime() - b.date.getTime()),
        right,
      ),
    ),
    map((): Ledger => ({ directives })),
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
  ctx: LoadContext,
): Promise<Either<LoadError, unknown>> {
  const contents = await read(filePath);
  if (isLeft(contents)) {
    return left(
      new LoadError(contents.left.message, ctx.stackTrace[0], ctx.stackTrace, {
        cause: contents.left,
      }),
    );
  }
  const result = parse(contents.right);

  if (isLeft(result)) {
    return left(
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
  }): Either<LoadError, Date> => {
    const dateStr = directive.date.time
      ? `${directive.date.date}T${directive.date.time}${directive.date.timezone ?? ctx.defaultTimezone}`
      : directive.date.date;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return left(
        new LoadError(
          `Invalid date '${dateStr}'`,
          makeSourceContext(filePath, directive.srcPos),
          ctx.stackTrace,
        ),
      );
    }
    return right(date);
  };

  for (const directive of result.right.directives) {
    switch (directive.type) {
      case 'load': {
        const toLoad = makeRelativePath(filePath, directive.path);
        const loadedFrom = ctx.loadedMap.get(toLoad);
        if (loadedFrom !== undefined) {
          return left(
            new LoadError(
              `Circular load dependency detected: ${toLoad} was already ` +
                `loaded (at ${formatSourceContext(loadedFrom)})`,
              makeSourceContext(filePath, directive.srcPos),
              ctx.stackTrace,
            ),
          );
        }
        const loadResult = await doLoad(toLoad, directives, {
          ...ctx,
          stackTrace: [
            makeSourceContext(filePath, directive.srcPos),
            ...ctx.stackTrace,
          ],
        });
        if (isLeft(loadResult)) {
          return loadResult;
        }
        break;
      }
      case 'open': {
        const date = makeDate(directive);
        if (isLeft(date)) {
          return date;
        }
        directives.push({
          type: 'open',
          date: date.right,
          account: directive.account,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
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
        if (isLeft(date)) {
          return date;
        }
        directives.push({
          type: 'transaction',
          date: date.right,
          description: directive.description,
          postings: directive.postings,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
        });
        break;
      }
      default: {
        const d = directive as DirectiveCommonSpec<string>;
        return left(
          new LoadError(
            `${d.type} directive not implemented yet`,
            makeSourceContext(filePath, d.srcPos),
            ctx.stackTrace,
          ),
        );
      }
    }
  }

  return right(undefined);
}

async function read(filePath: string): Promise<Either<Error, string>> {
  try {
    return right(await readFile(resolve(filePath), { encoding: 'utf-8' }));
  } catch (e) {
    if (e instanceof Error) {
      return left(e);
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
