import { strict as assert } from 'node:assert';

import { parse as parseDate } from 'date-fns';
import { Either, isLeft, left, right } from 'fp-ts/lib/Either.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

import { parse } from '../parsing/parser.js';
import { DateSpec } from '../parsing/spec/date.js';
import { Directive } from './directive.js';
import { LoadError } from './error.js';
import { Ledger } from './ledger.js';
import { makeSourceContext } from './source-context.js';

export interface LoadOptions {
  readonly defaultTimezone: string;
}

export async function load(
  filePath: string,
  options: LoadOptions,
): Promise<Either<LoadError, Ledger>> {
  const contents = await readFile(resolve(filePath), { encoding: 'utf-8' });
  const result = parse(contents);

  if (isLeft(result)) {
    return left(
      new LoadError(
        result.left.message,
        makeSourceContext(filePath, result.left.srcPos),
        { cause: result.left },
      ),
    );
  }

  const directives: Directive[] = [];

  for (const directive of result.right.directives) {
    switch (directive.type) {
      case 'open':
        directives.push({
          type: 'open',
          date: makeDate(directive.date, options.defaultTimezone),
          account: directive.account,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
        });
        break;
      case 'transaction':
        directives.push({
          type: 'transaction',
          date: makeDate(directive.date, options.defaultTimezone),
          description: directive.description,
          postings: directive.postings,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
        });
        break;
      default:
        assert.fail('reached unreachable code');
    }
  }

  directives.sort((a, b) => a.date.getTime() - b.date.getTime());

  return right({ directives });
}

function makeDate(dateSpec: DateSpec, defaultTimezone: string): Date {
  const date = [dateSpec.date];
  const fmt = ['yyyy-MM-dd'];

  const time = dateSpec.time ?? '00:00:00';
  date.push(time);
  if (time.length > 5) {
    fmt.push('HH:mm:ss');
  } else {
    fmt.push('HH:mm');
  }

  const timezone = dateSpec.timezone ?? defaultTimezone;
  date.push(timezone);
  fmt.push('XXX');

  return parseDate(date.join(' '), fmt.join(' '), 0);
}
