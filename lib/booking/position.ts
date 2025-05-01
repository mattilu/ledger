import { inspect, InspectOptionsStylized } from 'util';

import { Amount } from '../core/amount.js';
import { Cost } from './cost.js';

/**
 * A Position represents an amount possibly held at cost.
 */
export class Position {
  constructor(
    /** Amount of the position */
    readonly amount: Amount,
    /** Optional cost of the position */
    readonly cost: Cost | null,
  ) {}

  toString() {
    const parts = [this.amount.toString()];
    if (this.cost !== null) {
      parts.push(this.cost.toString());
    }
    return parts.join(' ');
  }

  [inspect.custom](_depth: number, options: InspectOptionsStylized) {
    const parts = [inspect(this.amount, options)];
    if (this.cost !== null) {
      parts.push(inspect(this.cost, options));
    }
    return parts.join(' ');
  }
}
