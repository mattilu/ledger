import { strict as assert } from 'node:assert';

import { inspect, InspectOptionsStylized } from 'util';

import { Amount } from '../core/amount.js';
import { DateSpec } from '../parsing/spec/date.js';

export class Cost {
  constructor(
    /** Per-unit amounts of the cost */
    readonly amounts: Amount[],
    /** Date of the cost */
    readonly date: Date,
    /** DateSpec of the cost */
    readonly dateSpec: DateSpec,
    /** tags of the cost */
    readonly tags: string[],
  ) {
    assert(amounts.length > 0, 'Cost amounts must not be empty');
  }

  toString() {
    const parts: string[] = [
      ...this.amounts.map(x => x.toString()),
      this.date.toJSON(),
      ...this.tags.map(x => `"${x}"`),
    ];
    return `{ ${parts.join(', ')} }`;
  }

  [inspect.custom](_depth: number, options: InspectOptionsStylized) {
    return options.stylize(this.toString(), 'special');
  }
}
