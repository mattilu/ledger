import { inspect, InspectOptionsStylized } from 'node:util';

import { ExactNumberType as N } from 'exactnumber';

export class Amount {
  constructor(
    readonly amount: N,
    readonly currency: string,
  ) {}

  toString() {
    return `${this.amount.toString(10, 18)} ${this.currency}`;
  }

  toJSON() {
    return {
      amount: this.amount.toString(10, 18),
      currency: this.currency,
    };
  }

  [inspect.custom](_depth: number, options: InspectOptionsStylized) {
    return options.stylize(this.toString(), 'number');
  }
}
