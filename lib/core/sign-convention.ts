import { either as E } from 'fp-ts';

import {
  AccountType,
  getAccountTypeUnchecked,
  getDefaultNormalBalanceSide,
  NormalBalanceSide,
} from './account.js';
import { Amount } from './amount.js';

/**
 * Defines the sign convention used when loading and displaying the ledger.
 * This can be used to make the ledger more intuitive to use for users who are
 * used to different accounting conventions.
 *
 * Note: only the input and output formats are affected by the selected mode,
 * and the internal representation of the ledger always obeys the following
 * accounting equation:
 *
 * Assets + Liabilities + Equity + Income + Expenses = 0
 */
export enum SignConvention {
  /**
   * The legacy, beancount-compatible mode.
   *
   * In this mode, debits always have positive sign and debits always have
   * negative sign, regardless of the account type and normal-balance side.
   *
   * Normal balances sign (default / contra):
   *
   *   - Assets:      positive / negative
   *   - Liabilities: negative / positive
   *   - Equity:      negative / positive
   *   - Income:      negative / positive
   *   - Expenses:    positive / negative
   *
   * Position signs for Trading accounts (default / contra):
   *
   *   - Long:  negative / negative
   *   - Short: positive / positive
   */
  Legacy = 'legacy',

  /** Alias for legacy. */
  Beancount = 'beancount',

  /**
   * In this mode, positive signs always increase the normal-balance of the
   * account, negative signs decrease it.
   *
   * Normal balances sign (default / contra):
   *
   *   - Assets:      positive / positive
   *   - Liabilities: positive / positive
   *   - Equity:      positive / positive
   *   - Income:      positive / positive
   *   - Expenses:    positive / positive
   *
   * Position signs for Trading accounts (default / contra):
   *
   *   - Long:  positive / negative
   *   - Short: negative / positive
   */
  NormalBalancePositive = 'normal-balance-positive',

  /**
   * In this mode, positive signs represent an increase in net wealth, negative
   * signs decrease it.
   *
   * Normal balances sign (default / contra):
   *
   *   - Assets:      positive / negative
   *   - Liabilities: negative / positive
   *   - Equity:      positive / negative
   *   - Income:      positive / negative
   *   - Expenses:    negative / positive
   *
   * Position signs for Trading accounts (default / contra):
   *
   *   - Long:  positive / negative
   *   - Short: negative / positive
   */
  NetWorthPositive = 'net-worth-positive',
}

/** Default sign convention. */
export const DefaultSignConvention = SignConvention.Legacy;

const KnownSignConventionsStr = Object.values(SignConvention)
  .map(x => [`'${x}'`])
  .join(', ');
const ParseSignConventionError = E.left(
  `expected one of ${KnownSignConventionsStr}`,
);

/**
 * Parses a SignConvention from a string.
 *
 * @param value The value to parse.
 * @returns Either the parsed SignConvention, or a string with the error.
 */
export function parseSignConvention(
  value: string,
): E.Either<string, SignConvention> {
  switch (value) {
    case SignConvention.Legacy:
      return E.of(SignConvention.Legacy);
    case SignConvention.Beancount:
      return E.of(SignConvention.Beancount);
    case SignConvention.NormalBalancePositive:
      return E.of(SignConvention.NormalBalancePositive);
    case SignConvention.NetWorthPositive:
      return E.of(SignConvention.NetWorthPositive);
    default:
      return ParseSignConventionError;
  }
}

/**
 * Converts an Amount from the display sign to the internal canonical sign, (and
 * vice versa).
 *
 * @param amount The amount to convert.
 * @param convention The sign convention to convert from/to.
 * @param accountType The account type holding the amount to convert.
 * @param normalBalanceSide The normal-balance side of the account.
 * @returns The converted amount.
 */
export function fromToCanonicalAmount(
  amount: Amount,
  convention: SignConvention,
  accountType: AccountType,
  normalBalanceSide: NormalBalanceSide,
): Amount {
  return conversionSign(convention, accountType, normalBalanceSide) === 1
    ? amount
    : amount.neg();
}

/**
 * Interface to provide normal-balance side overrides.
 */
export interface NormalBalanceOverrides {
  get(account: string): NormalBalanceSide | undefined;
}

/**
 * Provides methods to convert from/to canonical amounts.
 */
export class CanonicalAmountConverter {
  private readonly accountCache = new Map<string, NormalBalanceSide>();

  constructor(private readonly overrides: NormalBalanceOverrides) {}

  /**
   * Clears the internal cache.
   *
   * When the normal-balance overrides provided by `overrides` change, this
   * function must be called before calls to any other methods are done.
   * Failure to do so may cause them to yield invalid results.
   */
  clearCache() {
    this.accountCache.clear();
  }

  /**
   * Computes the normal-balance side for the given account.
   *
   * The function looks for the closest account override in the ancestry path of
   * the account, falling back to the default normal-balance side of the account
   * type if no override is found.
   *
   * If the input account is not a valid account, behavior is undefined.
   *
   * @param account The account to get the normal-balance side for.
   * @returns The `NormalBalanceSide` for the account.
   */
  getNormalBalanceSide(account: string): NormalBalanceSide {
    const toUpdate: string[] = [];
    let result: NormalBalanceSide;

    while (true) {
      const cached = this.accountCache.get(account);
      if (cached !== undefined) {
        result = cached;
        break;
      }

      toUpdate.push(account);

      const override = this.overrides.get(account);
      if (override !== undefined) {
        result = override;
        break;
      }

      const separator = account.lastIndexOf(':');
      if (separator === -1) {
        result = getDefaultNormalBalanceSide(account as AccountType);
        break;
      }

      account = account.substring(0, separator);
    }

    for (const account of toUpdate) {
      this.accountCache.set(account, result);
    }

    return result;
  }

  /**
   * Converts from/to canonical to presentation amounts.
   *
   * @param amount Amount to convert.
   * @param convention Sign convention to use for the conversion.
   * @param account Account holding the amount to convert.
   * @returns The converted amount.
   */
  convert(amount: Amount, convention: SignConvention, account: string): Amount {
    return this.getConversionSign(convention, account) === 1
      ? amount
      : amount.neg();
  }

  /**
   * A curried version of `convert`, use this if you need to convert multiple
   * amounts for the same account and sign convention, to avoid duplicated work.
   *
   * @param convention Convention to use for the conversion.
   * @param account Account holding the amounts to convert.
   * @returns A function to convert amounts between accounts.
   */
  getConvertFn(
    convention: SignConvention,
    account: string,
  ): (amount: Amount) => Amount {
    return this.getConversionSign(convention, account) === 1
      ? amount => amount
      : amount => amount.neg();
  }

  private getConversionSign(
    convention: SignConvention,
    account: string,
  ): -1 | 1 {
    return conversionSign(
      convention,
      getAccountTypeUnchecked(account),
      this.getNormalBalanceSide(account),
    );
  }
}

function conversionSign(
  convention: SignConvention,
  accountType: AccountType,
  normalBalanceSide: NormalBalanceSide,
): -1 | 1 {
  switch (convention) {
    case SignConvention.Legacy:
    case SignConvention.Beancount:
      return 1;
    case SignConvention.NormalBalancePositive:
      return normalBalanceSide === NormalBalanceSide.Debit ? 1 : -1;
    case SignConvention.NetWorthPositive:
      return accountType === AccountType.Assets ||
        accountType === AccountType.Liabilities
        ? 1
        : -1;
  }
}
