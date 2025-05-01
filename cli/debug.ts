import { command, number, option, optional, positional, string } from 'cmd-ts';
import {
  asUnit,
  Either,
  flatMap,
  left,
  mapLeft,
  right,
  tap,
} from 'fp-ts/lib/Either.js';
import { flow, pipe } from 'fp-ts/lib/function.js';
import { inspect } from 'util';

import { book } from '../lib/booking/booking.js';
import { BookedLedger } from '../lib/booking/ledger.js';
import { Ledger } from '../lib/loading/ledger.js';
import { load } from '../lib/loading/loader.js';
import { SourceContext } from '../lib/loading/source-context.js';
import { CommandError } from './error.js';

export const debug = command({
  name: 'debug',
  args: {
    inputFile: positional({
      displayName: 'file',
      type: string,
      description: 'Input ledger file to process',
    }),
    file: option({
      long: 'file',
      short: 'f',
      type: optional(string),
      description:
        'File containing the directive to debug. Defaults to input file',
    }),
    line: option({
      long: 'line',
      short: 'l',
      type: number,
      description: 'Line number of the directive to debug',
    }),
  },
  handler: async ({
    inputFile,
    file,
    line,
  }): Promise<Either<CommandError, void>> => {
    file = file ?? inputFile;
    return pipe(
      await load(inputFile),
      mapLeft(CommandError.fromLoadError),
      tap(debugLoadResult(file, line)),
      flatMap(flow(book, mapLeft(CommandError.fromBookingError))),
      tap(debugBookResult(file, line)),
      asUnit,
    );
  },
});

const debugLoadResult = (file: string, line: number) => (ledger: Ledger) => {
  const directive = find(ledger.directives, file, line);

  if (!directive) {
    return left(new CommandError(`No directive found at ${file}:${line}`));
  }

  console.log(
    'Directive: %s',
    inspect(directive, { depth: null, colors: true }),
  );

  return right(undefined);
};

const debugBookResult =
  (file: string, line: number) => (ledger: BookedLedger) => {
    const transaction = find(ledger.transactions, file, line);

    if (!transaction) {
      return left(new CommandError(`No transaction found at ${file}:${line}`));
    }

    console.log(
      'Transaction: %s',
      inspect(
        {
          ...transaction,
          inventoriesBefore: transaction.inventoriesBefore.toJS(),
          inventoriesAfter: transaction.inventoriesAfter.toJS(),
        },
        { depth: null, colors: true },
      ),
    );

    return right(undefined);
  };

function find<T extends { srcCtx: SourceContext }>(
  items: readonly T[],
  file: string,
  line: number,
): T | undefined {
  let found: T | undefined;

  for (const item of items) {
    if (item.srcCtx.filePath !== file) {
      continue;
    }
    if (item.srcCtx.row === line) {
      return item;
    }
    if (item.srcCtx.row < line) {
      if (!found || found.srcCtx.row < item.srcCtx.row) {
        found = item;
      }
    }
  }

  return found;
}
