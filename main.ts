import { exit } from 'node:process';

import { run } from 'cmd-ts';
import { mapLeft } from 'fp-ts/lib/Either.js';
import { pipe } from 'fp-ts/lib/function.js';

import { app } from './cli/app.js';

async function main() {
  const { value } = await run(app, process.argv.slice(2));
  pipe(
    await value,
    mapLeft(err => console.error(err.message)),
    mapLeft(() => exit(1)),
  );
}

await main();
