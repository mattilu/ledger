import {
  array,
  command,
  flag,
  multioption,
  number,
  option,
  optional,
  positional,
  string,
  subcommands,
  Type,
} from 'cmd-ts';
import { ArgParser, ParsingInto } from 'cmd-ts/dist/cjs/argparser.js';
import { either as E, function as F } from 'fp-ts';

import { book } from '../lib/booking/booking.js';
import { Ledger } from '../lib/loading/ledger.js';
import { load } from '../lib/loading/loader.js';
import { CashFlowReport } from '../lib/reporting/cash-flow.js';
import { InventoryReport } from '../lib/reporting/inventory.js';
import { Report } from '../lib/reporting/report.js';
import { TransactionsReport } from '../lib/reporting/transactions.js';
import { partitionLo } from '../lib/utils/bounds.js';
import {
  FormatBalanceMode,
  FormatInventoriesOptions,
} from '../lib/utils/formatting.js';
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

const formatInventoryArgs = {
  hideCost: flag({
    long: 'hide-cost',
    short: 'C',
    description: 'If true, only show the amount of positions held at cost',
  }),
  tree: flag({
    long: 'tree',
    short: 't',
    description: 'Format the report as a tree',
  }),
  showTotals: flag({
    long: 'totals',
    short: 'T',
    description:
      'Show totals of descendant accounts on each parent. Only effective with `--tree`',
  }),
  maxDepth: option({
    long: 'max-depth',
    short: 'M',
    type: optional(number),
    description:
      'Max depth of the account tree to display. Only effective with `--tree`',
  }),
};

function makeInventoryFormatOptions(options: {
  hideCost: boolean;
  tree: boolean;
  showTotals: boolean;
  maxDepth?: number;
}): FormatInventoriesOptions {
  return {
    showCost: !options.hideCost,
    tree: options.tree,
    showTotals: options.showTotals,
    maxDepth: options.maxDepth,
  };
}

const cashFlow = command({
  name: 'cash-flow',
  args: {
    ...commonArgs,
    dateFrom: option({
      long: 'date-from',
      short: 'd',
      type: optional(date),
      description: 'Only report transactions from this date onwards',
    }),
    showFromAccounts: flag({
      long: 'show-from',
      short: 'f',
      description: 'Wheter to show the corresponding accounts of the cash flow',
    }),
    ...formatInventoryArgs,
  },
  handler: args =>
    runReport(
      new CashFlowReport({
        dateFrom: args.dateFrom,
        accounts: args.accounts,
        excludeAccounts: args.excludeAccounts,
        currencies: args.currencies,
        showFromAccounts: args.showFromAccounts,
        formatOptions: makeInventoryFormatOptions(args),
      }),
      args,
    ),
});

const inventory = command({
  name: 'inventory',
  args: {
    ...commonArgs,
    ...formatInventoryArgs,
  },
  handler: args =>
    runReport(
      new InventoryReport({
        accounts: args.accounts,
        excludeAccounts: args.excludeAccounts,
        currencies: args.currencies,
        formatOptions: makeInventoryFormatOptions(args),
      }),
      args,
    ),
});

const formatBalance: Type<string, FormatBalanceMode> = {
  async from(value) {
    switch (value) {
      case 'none':
        return FormatBalanceMode.None;
      case 'full':
        return FormatBalanceMode.Full;
      case 'aggregate':
        return FormatBalanceMode.Aggregate;
      default:
        throw new Error(
          `Invalid value '${value}'. Expected one of 'none', 'full', or 'aggregate'.`,
        );
    }
  },
  description: "One of 'none', 'full', or 'aggregate'",
  defaultValue: () => FormatBalanceMode.None,
};

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
    formatBalance: option({
      long: 'balance',
      short: 'b',
      type: formatBalance,
      description: `Determines the formatting for the running balance after each posting. ${formatBalance.description}`,
    }),
  },
  handler: args => runReport(new TransactionsReport(args), args),
});

type Output<Args extends Record<string, ArgParser<unknown>>> = {
  [key in keyof Args]: ParsingInto<Args[key]>;
};

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
    directives: partitionLo(
      ledger.directives,
      t => t.date.getTime() <= date.getTime(),
    ),
    currencyMap: ledger.currencyMap,
  });

export const report = subcommands({
  name: 'report',
  cmds: {
    'cash-flow': cashFlow,
    inventory,
    transactions,
  },
});
