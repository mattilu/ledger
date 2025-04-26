import { Map, Seq } from 'immutable';

import { InventoryMap } from '../booking/inventory.js';
import { BookedLedger } from '../booking/ledger.js';
import { Report } from './report.js';

export interface InventoryReportOptions {
  /**
   * If specified, limits reporting to these accounts. Can use regexes.
   */
  readonly accounts?: readonly string[];
}

/**
 * Reports final state of the inventories for each account.
 */
export class InventoryReport implements Report {
  private accountRegex: RegExp | null;
  constructor(options: InventoryReportOptions) {
    if (options.accounts && options.accounts.length > 0) {
      this.accountRegex = new RegExp(
        `^(?:${options.accounts.join('|')})$`,
        'i',
      );
    } else {
      this.accountRegex = null;
    }
  }

  run(ledger: BookedLedger): string {
    const inventoryMap =
      ledger.transactions.length > 0
        ? ledger.transactions[ledger.transactions.length - 1].inventoriesAfter
        : (Map() as InventoryMap);

    const report: string[] = [];

    for (const [account, inventory] of inventoryMap
      .entrySeq()
      .sortBy(x => x[0])) {
      if (this.accountRegex && !this.accountRegex.test(account)) {
        continue;
      }
      for (const position of Seq(inventory.getPositions()).sortBy(a =>
        Seq([a.amount.currency, a.cost?.date.getTime() ?? 0]),
      )) {
        report.push(`${account} ${position}`);
      }
    }

    return report.join('\n');
  }
}
