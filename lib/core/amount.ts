import { inspect, InspectOptionsStylized } from 'node:util';

import { ExactNumber, ExactNumberType as N } from 'exactnumber';

const ZERO = ExactNumber(0);

export class Amount {
  constructor(
    readonly amount: N,
    readonly currency: string,
  ) {}

  /**
   * Constructs a zero amount for the given currency.
   */
  public static zero(currency: string) {
    return new Amount(ZERO, currency);
  }

  /**
   * Returns true if the amount is zero.
   */
  isZero(): boolean {
    return this.amount.isZero();
  }

  /**
   * Returns the current amount, with inverted sign.
   */
  neg(): Amount {
    return new Amount(this.amount.neg(), this.currency);
  }

  /**
   * Returns the sum of this amount and the given one.
   *
   * @param rhs Amount to add to the current one.
   * @returns A new amount with the sum.
   */
  add(rhs: Amount): Amount {
    this.ensureSameCurrency(rhs, 'add');
    return amount(this.amount.add(rhs.amount), this.currency);
  }

  /**
   * Returns the difference of this amount and the given one.
   *
   * @param rhs Amount to add to the current one.
   * @returns A new amount with the sum.
   */
  sub(rhs: Amount): Amount {
    this.ensureSameCurrency(rhs, 'sub');
    return amount(this.amount.sub(rhs.amount), this.currency);
  }

  /**
   * Returns the product of this amount and the given number.
   *
   * @param rhs Number to multiply the current amount by.
   * @returns A new amount with the product.
   */
  mul(rhs: N): Amount {
    return amount(this.amount.mul(rhs), this.currency);
  }

  /**
   * Returns the division of this amount and the given number.
   *
   * @param rhs Number to divide the current amount by.
   * @returns A new amount with the division.
   */
  div(rhs: N): Amount {
    return amount(this.amount.div(rhs), this.currency);
  }

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

  private ensureSameCurrency(a: Amount, op: string) {
    if (this.currency !== a.currency) {
      throw new Error(
        `Invalid '${op}' operation between currencies '${this.currency}' and '${a.currency}'`,
      );
    }
  }
}

function amount(amount: N, currency: string) {
  // Normalize to improve performance.
  return new Amount(amount.normalize(), currency);
}
