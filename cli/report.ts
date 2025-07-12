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
import { either as E, function as F } from 'fp-ts';

import { book } from '../lib/booking/booking.js';
import { Ledger } from '../lib/loading/ledger.js';
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
  currencies: multioption({
    long: 'currency',
    short: 'c',
    type: array(string),
    description: 'Regex to match currencies to include; can be repeated',
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
    dateFrom: option({
      long: 'date-from',
      short: 'd',
      type: optional(date),
      description: 'Only report transactions from this date onwards',
    }),
    flags: multioption({
      long: 'flag',
      short: 'f',
      type: array(string),
      description: 'Flag to filter transactions to include; can be repeated',
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
): Promise<E.Either<CommandError, void>> {
  return F.pipe(
    await load(inputFile),
    E.mapLeft(CommandError.fromLoadError),
    E.map(date ? dropAfter(date) : F.identity),
    E.flatMap(F.flow(book, E.mapLeft(CommandError.fromBookingError))),
    E.tap(F.flow(l => report.run(l), console.log, E.right)),
    E.asUnit,
  );
}

const dropAfter =
  (date: Date) =>
  (ledger: Ledger): Ledger => ({
    directives: ledger.directives.slice(
      0,
      lowerBound(
        ledger.directives,
        date,
        t => t.date.getTime() <= date.getTime(),
      ),
    ),
    currencyMap: ledger.currencyMap,
  });

export const report = subcommands({
  name: 'report',
  cmds: {
    inventory,
    transactions,
  },
});
