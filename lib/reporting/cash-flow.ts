import { Map as ImmutableMap } from 'immutable';

import { Inventory, InventoryMap } from '../booking/inventory.js';
import { BookedLedger } from '../booking/ledger.js';
import { Position } from '../booking/position.js';
import { BookedPosting } from '../booking/transaction.js';
import { partitionHi } from '../utils/bounds.js';
import { FormatInventoriesOptions, Formatter } from '../utils/formatting.js';
import { makeRegexp } from './internal/regexp-utils.js';
import { Report } from './report.js';

export interface CashFlowReportOptions {
  /**
   * If specified, only report transactions from this date onwards.
   */
  readonly dateFrom?: Date;

  /**
   * The accounts to include in the report. Can use regexes. If unspecified,
   * defaults to `(Assets|Liabilities):.*`.
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
   * If true, also show the corresponding accounts of the cash flow.
   */
  readonly showFromAccounts?: boolean;

  /**
   * Options for formatting of the inventory.
   */
  readonly formatOptions?: FormatInventoriesOptions;
}

export class CashFlowReport implements Report {
  private readonly accountsRegex: RegExp;
  private readonly excludeAccountRegex: RegExp | null;
  private readonly currenciesRegex: RegExp | null;

  constructor(private readonly options: CashFlowReportOptions) {
    this.accountsRegex = makeRegexp(
      options.accounts && options.accounts.length > 0
        ? options.accounts
        : ['(Assets|Liabilities):.*'],
    )!;
    this.excludeAccountRegex = makeRegexp(options.excludeAccounts ?? []);
    this.currenciesRegex = makeRegexp(options.currencies ?? []);
  }

  run(ledger: BookedLedger): string {
    const report: string[] = [];

    const transactions = this.options.dateFrom
      ? partitionHi(
          ledger.transactions,
          t => t.date.getTime() < this.options.dateFrom!.getTime(),
        )
      : ledger.transactions;

    let inventoriesTo: InventoryMap = ImmutableMap();
    let inventoriesFrom: InventoryMap = ImmutableMap();

    for (const transaction of transactions) {
      const postingsTo: BookedPosting[] = [];
      const postingsFrom: BookedPosting[] = [];

      for (const posting of transaction.postings) {
        if (
          this.accountsRegex.test(posting.account) &&
          (this.excludeAccountRegex === null ||
            !this.excludeAccountRegex.test(posting.account)) &&
          (this.currenciesRegex === null ||
            this.currenciesRegex.test(posting.amount.currency) ||
            posting.cost?.amounts.some(x =>
              this.currenciesRegex!.test(x.currency),
            ))
        ) {
          postingsTo.push(posting);
        } else {
          postingsFrom.push(posting);
        }
      }

      if (postingsTo.length > 0) {
        inventoriesTo = inventoriesTo.withMutations(inventoriesTo => {
          for (const posting of postingsTo) {
            inventoriesTo.update(posting.account, Inventory.Empty, inventory =>
              inventory.addPosition(new Position(posting.amount, posting.cost)),
            );
          }
        });
        if (this.options.showFromAccounts) {
          inventoriesFrom = inventoriesFrom.withMutations(inventoriesFrom => {
            for (const posting of postingsFrom) {
              inventoriesFrom.update(
                posting.account,
                Inventory.Empty,
                inventory =>
                  inventory.addPosition(
                    new Position(posting.amount, posting.cost),
                  ),
              );
            }
          });
        }
      }
    }

    const formatter = new Formatter({ currencyMap: ledger.currencyMap });

    report.push('Cash flows:\n');
    report.push(
      formatter.formatInventories(inventoriesTo, this.options.formatOptions),
    );

    if (this.options.showFromAccounts) {
      report.push('\nFrom accounts:\n');
      report.push(
        formatter.formatInventories(
          inventoriesFrom,
          this.options.formatOptions,
        ),
      );
    }

    return report.join('\n');
  }
}
