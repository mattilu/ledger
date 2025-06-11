import { Seq } from 'immutable';

import { BookedLedger } from '../booking/ledger.js';
import { Formatter } from '../utils/formatting.js';
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
}

/**
 * Reports final state of the inventories for each account.
 */
export class InventoryReport implements Report {
  private readonly accountRegex: RegExp | null;
  private readonly excludeAccountRegex: RegExp | null;
  private readonly currenciesRegex: RegExp | null;

  constructor(options: InventoryReportOptions) {
    this.accountRegex = makeRegexp(options.accounts ?? []);
    this.excludeAccountRegex = makeRegexp(options.excludeAccounts ?? []);
    this.currenciesRegex = makeRegexp(options.currencies ?? []);
  }

  run(ledger: BookedLedger): string {
    const inventories = ledger.inventories
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

    const formatter = new Formatter({ currencyMap: ledger.currencyMap });
    const report: string[] = [];

    for (const [account, inventory] of inventories) {
      const positions = Seq(inventory.getPositions())
        .filter(
          position =>
            this.currenciesRegex === null ||
            this.currenciesRegex.test(position.amount.currency) ||
            position.cost?.amounts.some(x =>
              this.currenciesRegex!.test(x.currency),
            ),
        )
        .sortBy(a => Seq([a.amount.currency, a.cost?.date.getTime() ?? 0]));

      for (const position of positions) {
        report.push(`${account} ${formatter.formatPosition(position)}`);
      }
    }

    return report.join('\n');
  }
}
