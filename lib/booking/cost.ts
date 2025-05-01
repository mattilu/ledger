import { strict as assert } from 'node:assert';

import { inspect, InspectOptionsStylized } from 'util';

import { Amount } from '../core/amount.js';

export class Cost {
  constructor(
    /** Per-unit amounts of the cost */
    readonly amounts: Amount[],
    /** Date of the cost */
    readonly date: Date,
  ) {
    assert(amounts.length > 0, 'Cost amounts must not be empty');
  }

  toString() {
    const parts: string[] = [
      ...this.amounts.map(x => x.toString()),
      this.date.toJSON(),
    ];
    return `{ ${parts.join(', ')} }`;
  }

  [inspect.custom](_depth: number, options: InspectOptionsStylized) {
    return options.stylize(this.toString(), 'special');
  }
}
