import { Map } from 'immutable';

import { Cost } from '../booking/cost.js';
import { Position } from '../booking/position.js';
import { Transaction } from '../booking/transaction.js';
import { Amount } from '../core/amount.js';
import { CurrencyDirective } from '../loading/directives/currency.js';

export interface FormatterOptions {
  readonly currencyMap: Map<string, CurrencyDirective>;
}

const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;
const MILLISECONDS_PER_MINUTE = 1000 * 60;

export class Formatter {
  constructor(readonly options: FormatterOptions) {}

  formatDate(date: Date): string {
    const year = date.getUTCFullYear().toString().padStart(4, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');

    if (date.getTime() % MILLISECONDS_PER_DAY === 0) {
      return `${year}-${month}-${day}`;
    }

    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    if (date.getTime() % MILLISECONDS_PER_MINUTE === 0) {
      return `${year}-${month}-${day} ${hours}:${minutes}Z`;
    }

    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}Z`;
  }

  formatAmount(amount: Amount): string {
    const decimals = this.options.currencyMap
      .get(amount.currency)
      ?.meta.get('format-decimals');
    return decimals === undefined || decimals.type !== 'number'
      ? amount.toString()
      : amount.toFixed(decimals.value.toNumber());
  }

  formatCost(cost: Cost): string {
    const parts = [
      ...cost.amounts.map(amount => this.formatAmount(amount)),
      this.formatDate(cost.date),
      ...cost.tags.map(tag => `"${tag}"`),
    ];
    return `{ ${parts.join(', ')} }`;
  }

  formatPosition(position: Position): string {
    const parts = [this.formatAmount(position.amount)];
    if (position.cost !== null) {
      parts.push(this.formatCost(position.cost));
    }
    return parts.join(' ');
  }

  formatTransaction(transaction: Transaction): string {
    const parts = [
      `${this.formatDate(transaction.date)} ${transaction.flag} "${transaction.description}"`,
    ];
    for (const posting of transaction.postings) {
      const flag = posting.flag !== transaction.flag ? `${posting.flag} ` : '';
      parts.push(
        posting.cost === null
          ? `  ${flag}${posting.account} ${this.formatAmount(posting.amount)}`
          : `  ${flag}${posting.account} ${this.formatAmount(posting.amount)} ${this.formatCost(posting.cost)}`,
      );
    }

    return parts.join('\n');
  }
}
