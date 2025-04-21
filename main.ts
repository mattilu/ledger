import { exit } from 'node:process';

import { run } from 'cmd-ts';
import { mapLeft } from 'fp-ts/lib/Either.js';
import { pipe } from 'fp-ts/lib/function.js';

import { app } from './cli/app.js';

type FlattenCommandResult<T> = T extends { value: infer U }
  ? FlattenCommandResult<U>
  : T extends Promise<infer U>
    ? FlattenCommandResult<U>
    : T;

async function flattenCommandResult<T>(
  result: T | Promise<T>,
): Promise<FlattenCommandResult<T>>;
async function flattenCommandResult<T>(result: Promise<T> | T) {
  for (;;) {
    const r = (await result) as { value?: T };
    if (r.value) {
      result = r.value;
    } else {
      return r;
    }
  }
}

async function main() {
  const result = await flattenCommandResult(run(app, process.argv.slice(2)));
  pipe(
    result,
    mapLeft(err => console.error(err.message)),
    mapLeft(() => exit(1)),
  );
}

await main();
