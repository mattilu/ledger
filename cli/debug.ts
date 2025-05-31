import { command, number, option, optional, positional, string } from 'cmd-ts';
import { either as E, function as F, tuple as T } from 'fp-ts';
import { Map, Set } from 'immutable';
import { inspect } from 'util';

import { book } from '../lib/booking/booking.js';
import { InventoryMap } from '../lib/booking/inventory.js';
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
  }): Promise<E.Either<CommandError, void>> => {
    file = file ?? inputFile;
    return F.pipe(
      await load(inputFile),
      E.mapLeft(CommandError.fromLoadError),
      E.flatMap(debugLoadResultAndFilter(file, line)),
      E.flatMap(F.flow(book, E.mapLeft(CommandError.fromBookingError))),
      E.tap(debugBookResult(file, line)),
      E.asUnit,
    );
  },
});

const debugLoadResultAndFilter =
  (file: string, line: number) =>
  (ledger: Ledger): E.Either<CommandError, Ledger> => {
    const [directive, index] = find(ledger.directives, file, line);

    if (!directive) {
      return E.left(new CommandError(`No directive found at ${file}:${line}`));
    }

    console.log(
      'Directive: %s',
      inspect(directive, { depth: null, colors: true }),
    );

    return E.right({
      directives: ledger.directives.slice(0, index + 1),
    });
  };

const debugBookResult =
  (file: string, line: number) => (ledger: BookedLedger) => {
    const [transaction] = find(ledger.transactions, file, line);

    if (!transaction) {
      return E.left(
        new CommandError(`No transaction found at ${file}:${line}`),
      );
    }

    const accounts = Set(transaction.postings.map(x => x.account));
    const currencies = Set(
      transaction.postings.flatMap(x => [
        x.amount.currency,
        ...(x.cost?.amounts.map(x => x.currency) ?? []),
      ]),
    ).sort();

    const filterInventories = (inventories: InventoryMap) =>
      Map(
        inventories
          .entrySeq()
          .filter(([account]) => accounts.has(account))
          .sortBy(T.fst)
          .map(([account, inventory]) => [
            account,
            currencies.flatMap(currency =>
              inventory.getPositionsForCurrency(currency),
            ),
          ]),
      ).toJS();
    console.log(
      'Transaction: %s',
      inspect(
        {
          ...transaction,
          inventoriesBefore: filterInventories(transaction.inventoriesBefore),
          inventoriesAfter: filterInventories(transaction.inventoriesAfter),
        },
        { depth: null, colors: true },
      ),
    );

    return E.right(undefined);
  };

function find<T extends { srcCtx: SourceContext }>(
  items: readonly T[],
  file: string,
  line: number,
): [T | undefined, number] {
  let found: T | undefined;
  let foundIndex = -1;

  for (const [i, item] of items.entries()) {
    if (item.srcCtx.filePath !== file) {
      continue;
    }
    if (item.srcCtx.row === line) {
      return [item, i];
    }
    if (item.srcCtx.row < line) {
      if (!found || found.srcCtx.row < item.srcCtx.row) {
        found = item;
        foundIndex = i;
      }
    }
  }

  return [found, foundIndex];
}
