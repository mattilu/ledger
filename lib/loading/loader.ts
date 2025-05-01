import { strict as assert } from 'node:assert';

import { Either, isLeft, left, right } from 'fp-ts/lib/Either.js';
import { readFile } from 'fs/promises';
import { Map } from 'immutable';
import { resolve } from 'path';

import { parse } from '../parsing/parser.js';
import { DateSpec } from '../parsing/spec/date.js';
import { Directive } from './directive.js';
import { LoadError } from './error.js';
import { Ledger } from './ledger.js';
import { makeSourceContext } from './source-context.js';

export async function load(
  filePath: string,
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

  let defaultTimezone = '+00:00';
  let optionMap = Map<string, string>([['default-timezone', defaultTimezone]]);

  const directives: Directive[] = [];

  for (const directive of result.right.directives) {
    switch (directive.type) {
      case 'open':
        directives.push({
          type: 'open',
          date: makeDate(directive.date, defaultTimezone),
          account: directive.account,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
        });
        break;
      case 'option':
        optionMap = optionMap.set(directive.optionName, directive.optionValue);
        if (directive.optionName === 'default-timezone') {
          defaultTimezone = directive.optionValue;
        }
        break;
      case 'transaction':
        directives.push({
          type: 'transaction',
          date: makeDate(directive.date, defaultTimezone),
          description: directive.description,
          postings: directive.postings,
          srcCtx: makeSourceContext(filePath, directive.srcPos),
        });
        break;
      case 'load':
        return left(
          new LoadError(
            '`load` directive not implemented yet',
            makeSourceContext(filePath, directive.srcPos),
          ),
        );
      default:
        assert.fail('reached unreachable code');
    }
  }

  directives.sort((a, b) => a.date.getTime() - b.date.getTime());

  return right({ directives });
}

function makeDate(dateSpec: DateSpec, defaultTimezone: string): Date {
  if (!dateSpec.time) {
    return new Date(dateSpec.date);
  }
  return new Date(
    `${dateSpec.date}T${dateSpec.time}${dateSpec.timezone ?? defaultTimezone}`,
  );
}
