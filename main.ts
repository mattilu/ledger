#!/usr/bin/env tsx
import { exit } from 'node:process';

import { run } from 'cmd-ts';
import { either as E, function as F } from 'fp-ts';

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
  F.pipe(
    result,
    E.mapLeft(err => console.error(err.message)),
    E.mapLeft(() => exit(1)),
  );
}

await main();
