import { Map } from 'immutable';

import { Inventory } from '../booking/inventory.js';
import { BookedLedger } from '../booking/ledger.js';
import { Position } from '../booking/position.js';
import { FormatInventoriesOptions, Formatter } from '../utils/formatting.js';
import { makeRegexp } from './internal/regexp-utils.js';
import { Report } from './report.js';

export interface InventoryReportOptions {
  /**
   * If specified, limits reporting to these accounts. Can use regexes.
   */
  readonly accounts?: readonly string[];

  /**
   * If specified, excludes these accounts from reporting. Can use regexes.
   */
  readonly excludeAccounts?: readonly string[];

  /**
   * If specified, limits reporting to these currencies. Can use regexes.
   */
  readonly currencies?: readonly string[];

  /**
   * Options for formatting of the inventory.
   */
  readonly formatOptions?: FormatInventoriesOptions;
}

/**
 * Reports final state of the inventories for each account.
 */
export class InventoryReport implements Report {
  private readonly accountRegex: RegExp | null;
  private readonly excludeAccountRegex: RegExp | null;
  private readonly currenciesRegex: RegExp | null;
  private readonly formatOptions?: FormatInventoriesOptions;

  constructor(options: InventoryReportOptions) {
    this.accountRegex = makeRegexp(options.accounts ?? []);
    this.excludeAccountRegex = makeRegexp(options.excludeAccounts ?? []);
    this.currenciesRegex = makeRegexp(options.currencies ?? []);
    this.formatOptions = options.formatOptions;
  }

  run(ledger: BookedLedger): string {
    let inventories = ledger.inventories.entrySeq();
    if (this.excludeAccountRegex) {
      inventories = inventories.filterNot(([account]) =>
        this.excludeAccountRegex!.test(account),
      );
    }
    if (this.accountRegex) {
      inventories = inventories.filter(([account]) =>
        this.accountRegex!.test(account),
      );
    }
    if (this.currenciesRegex) {
      inventories = inventories.map(
        ([account, inventory]) =>
          [
            account,
            filterInventory(inventory, position =>
              currencyMatches(position, this.currenciesRegex!),
            ),
          ] as const,
      );
    }

    const formatter = new Formatter({ currencyMap: ledger.currencyMap });
    return formatter.formatInventories(Map(inventories), this.formatOptions);
  }
}

function currencyMatches(position: Position, regex: RegExp): boolean {
  return (
    regex.test(position.amount.currency) ||
    !!position.cost?.amounts.some(x => regex.test(x.currency))
  );
}

function filterInventory(
  inventory: Inventory,
  pred: (position: Position) => boolean,
) {
  return Inventory.Empty.addPositions(inventory.getPositions().filter(pred));
}
