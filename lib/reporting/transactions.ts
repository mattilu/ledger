import { BookedLedger } from '../booking/ledger.js';
import { BookedPosting } from '../booking/transaction.js';
import { Report } from './report.js';

export interface TransactionsReportOptions {
  /**
   * If specified, limits reporting transactions that involve these accounts.
   */
  readonly accounts?: readonly string[];

  /**
   * If specified, limits reporting transactions that involve these currencies.
   */
  readonly currencies?: readonly string[];

  /**
   * If specified, report all postings from a transaction that matches the other
   * filters, even if the posting themselves don't match the filter. Default is
   * false.
   */
  readonly allPostings?: boolean;
}

/**
 * Reports booked transactions.
 */
export class TransactionsReport implements Report {
  private readonly accountsRegex: RegExp | null;
  private readonly currenciesRegex: RegExp | null;

  constructor(private readonly options: TransactionsReportOptions) {
    this.accountsRegex = makeRegexp(options.accounts ?? []);
    this.currenciesRegex = makeRegexp(options.currencies ?? []);
  }

  run(ledger: BookedLedger): string {
    const report: string[] = [];

    for (const transaction of ledger.transactions) {
      const postings: BookedPosting[] = [];
      for (const posting of transaction.postings) {
        if (
          this.matches(posting.account, this.accountsRegex) &&
          this.matches(posting.amount.currency, this.currenciesRegex)
        ) {
          postings.push(posting);
        }
      }

      if (postings.length > 0) {
        report.push(
          `${transaction.date.toJSON()} * "${transaction.description}"`,
        );

        const postingsToReport = this.options.allPostings
          ? transaction.postings
          : postings;
        for (const posting of postingsToReport) {
          report.push(
            posting.cost !== null
              ? `  ${posting.account} ${posting.amount} ${posting.cost}`
              : `  ${posting.account} ${posting.amount}`,
          );
        }

        report.push('');
      }
    }

    return report.join('\n');
  }

  private matches(value: string, regex: RegExp | null): boolean {
    return regex === null || regex.test(value);
  }
}

function makeRegexp(values: readonly string[]): RegExp | null {
  if (values.length === 0) {
    return null;
  }
  return new RegExp(`^(?:${values.join('|')})$`, 'i');
}
