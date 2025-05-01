import { Map, Seq } from 'immutable';

import { InventoryMap } from '../booking/inventory.js';
import { BookedLedger } from '../booking/ledger.js';
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
}

/**
 * Reports final state of the inventories for each account.
 */
export class InventoryReport implements Report {
  private readonly accountRegex: RegExp | null;
  private readonly excludeAccountRegex: RegExp | null;

  constructor(options: InventoryReportOptions) {
    this.accountRegex = makeRegexp(options.accounts ?? []);
    this.excludeAccountRegex = makeRegexp(options.excludeAccounts ?? []);
  }

  run(ledger: BookedLedger): string {
    const inventories = (
      ledger.transactions.length > 0
        ? ledger.transactions[ledger.transactions.length - 1].inventoriesAfter
        : (Map() as InventoryMap)
    )
      .entrySeq()
      .filterNot(
        ([account]) =>
          this.excludeAccountRegex !== null &&
          this.excludeAccountRegex.test(account),
      )
      .filter(
        ([account]) =>
          this.accountRegex === null || this.accountRegex.test(account),
      )
      .sortBy(x => x[0]);

    const report: string[] = [];

    for (const [account, inventory] of inventories) {
      const positions = Seq(inventory.getPositions()).sortBy(a =>
        Seq([a.amount.currency, a.cost?.date.getTime() ?? 0]),
      );

      for (const position of positions) {
        report.push(`${account} ${position}`);
      }
    }

    return report.join('\n');
  }
}

function makeRegexp(values: readonly string[]): RegExp | null {
  if (values.length === 0) {
    return null;
  }
  return new RegExp(`^(?:${values.join('|')})$`, 'i');
}
