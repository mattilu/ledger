import { BookedLedger } from '../booking/ledger.js';
import { BookedPosting, Transaction } from '../booking/transaction.js';
import { lowerBound } from '../utils/bounds.js';
import { FormatBalanceMode, Formatter } from '../utils/formatting.js';
import { makeRegexp } from './internal/regexp-utils.js';
import { Report } from './report.js';

export interface TransactionsReportOptions {
  /**
   * If specified, only process transactions from this date onwards.
   */
  readonly dateFrom?: Date;

  /**
   * If specified, limits reporting transactions that involve these accounts.
   */
  readonly accounts?: readonly string[];

  /**
   * If specified, excludes these accounts from reporting. Can use regexes.
   */
  readonly excludeAccounts?: readonly string[];

  /**
   * If specified, limits reporting transactions that involve these currencies.
   * Can use regexes.
   */
  readonly currencies?: readonly string[];

  /**
   * If specified, limits reporting transactions that match these flags.
   */
  readonly flags?: string[];

  /**
   * If specified, report all postings from a transaction that matches the other
   * filters, even if the posting themselves don't match the filter. Default is
   * false.
   */
  readonly allPostings?: boolean;

  /**
   * Determines how running balance is formatted. Defaults to `None`.
   */
  readonly formatBalance?: FormatBalanceMode;
}

/**
 * Reports booked transactions.
 */
export class TransactionsReport implements Report {
  private readonly accountsRegex: RegExp | null;
  private readonly excludeAccountsRegex: RegExp | null;
  private readonly currenciesRegex: RegExp | null;

  constructor(private readonly options: TransactionsReportOptions) {
    this.accountsRegex = makeRegexp(options.accounts ?? []);
    this.excludeAccountsRegex = makeRegexp(options.excludeAccounts ?? []);
    this.currenciesRegex = makeRegexp(options.currencies ?? []);
  }

  run(ledger: BookedLedger): string {
    const report: string[] = [];
    const flags = new Set(this.options.flags ?? []);

    const formatter = new Formatter({ currencyMap: ledger.currencyMap });
    const transactions = this.options.dateFrom
      ? takeFrom(ledger.transactions, this.options.dateFrom)
      : ledger.transactions;

    for (const transaction of transactions) {
      const transactionFlagMatches =
        flags.size === 0 || flags.has(transaction.flag);
      if (
        !transactionFlagMatches &&
        !transaction.postings.some(p => flags.has(p.flag))
      ) {
        continue;
      }

      const postings: BookedPosting[] = [];
      for (const posting of transaction.postings) {
        if (
          this.excludeAccountsRegex &&
          this.excludeAccountsRegex.test(posting.account)
        ) {
          continue;
        }

        if (
          matches(posting.account, this.accountsRegex) &&
          matches(posting.amount.currency, this.currenciesRegex) &&
          (flags.size === 0 ||
            flags.has(posting.flag) ||
            transactionFlagMatches)
        ) {
          postings.push(posting);
        }
      }

      if (postings.length > 0) {
        const postingsToReport = this.options.allPostings
          ? transaction.postings
          : postings;
        report.push(
          formatter.formatTransaction(
            {
              ...transaction,
              postings: postingsToReport,
            },
            { formatBalance: this.options.formatBalance },
          ),
        );

        report.push('');
      }
    }

    return report.join('\n');
  }
}

function matches(value: string, regex: RegExp | null): boolean {
  return regex === null || regex.test(value);
}

function takeFrom(transactions: Transaction[], dateFrom: Date) {
  return transactions.slice(
    lowerBound(
      transactions,
      dateFrom,
      t => t.date.getTime() < dateFrom.getTime(),
    ),
  );
}
