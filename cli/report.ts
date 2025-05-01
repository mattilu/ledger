import {
  array,
  command,
  flag,
  multioption,
  option,
  optional,
  positional,
  string,
  subcommands,
} from 'cmd-ts';
import { ArgParser, ParsingInto } from 'cmd-ts/dist/cjs/argparser.js';
import {
  asUnit,
  Either,
  flatMap,
  map,
  mapLeft,
  right,
  tap,
} from 'fp-ts/lib/Either.js';
import { flow, identity, pipe } from 'fp-ts/lib/function.js';

import { book } from '../lib/booking/booking.js';
import { BookedLedger } from '../lib/booking/ledger.js';
import { load } from '../lib/loading/loader.js';
import { InventoryReport } from '../lib/reporting/inventory.js';
import { Report } from '../lib/reporting/report.js';
import { TransactionsReport } from '../lib/reporting/transactions.js';
import { lowerBound } from '../lib/utils/bounds.js';
import { CommandError } from './error.js';
import { date } from './types/date.js';

const commonArgs = {
  inputFile: positional({
    displayName: 'file',
    type: string,
    description: 'Input ledger file to process',
  }),
  date: option({
    long: 'date',
    short: 'D',
    type: optional(date),
    description: 'Only process transactions up to this date',
  }),
  accounts: multioption({
    long: 'account',
    short: 'a',
    type: array(string),
    description: 'Regex to match accounts to include; can be repeated',
  }),
  excludeAccounts: multioption({
    long: 'exclude-account',
    short: 'A',
    type: array(string),
    description: 'Regex to match accounts to exclude; can be repeated',
  }),
};

type Output<Args extends Record<string, ArgParser<unknown>>> = {
  [key in keyof Args]: ParsingInto<Args[key]>;
};

const inventory = command({
  name: 'inventory',
  args: { ...commonArgs },
  handler: args => runReport(new InventoryReport(args), args),
});

const transactions = command({
  name: 'transactions',
  args: {
    ...commonArgs,
    currencies: multioption({
      long: 'currency',
      short: 'c',
      type: array(string),
      description: 'The currency to display transactions for; can be repeated',
    }),
    allPostings: flag({
      long: 'all-postings',
      description: 'Whether to display all the postings',
    }),
  },
  handler: args => runReport(new TransactionsReport(args), args),
});

async function runReport(
  report: Report,
  { inputFile, date }: Output<typeof commonArgs>,
): Promise<Either<CommandError, void>> {
  return pipe(
    await load(inputFile),
    mapLeft(CommandError.fromLoadError),
    flatMap(flow(book, mapLeft(CommandError.fromBookingError))),
    map(date ? dropAfter(date) : identity),
    tap(flow(l => report.run(l), console.log, right)),
    asUnit,
  );
}

const dropAfter =
  (date: Date) =>
  (ledger: BookedLedger): BookedLedger => ({
    transactions: ledger.transactions.slice(
      0,
      lowerBound(
        ledger.transactions,
        date,
        t => t.date.getTime() <= date.getTime(),
      ),
    ),
  });

export const report = subcommands({
  name: 'report',
  cmds: {
    inventory,
    transactions,
  },
});
