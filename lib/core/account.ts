import { either as E } from 'fp-ts';

/**
 * Enum representing all the recognized account types.
 */
export enum AccountType {
  Assets = 'Assets',
  Liabilities = 'Liabilities',
  Income = 'Income',
  Expenses = 'Expenses',
  Equity = 'Equity',
  Trading = 'Trading',
}

const KnownAccountTypesStr = Object.values(AccountType)
  .map(x => [`'${x}'`])
  .join(', ');
const GetAccountTypeError = E.left(`expected one of ${KnownAccountTypesStr}`);

/**
 * Extracts the top-level account type from an account name.
 *
 * @param account Full account name (e.g., "Assets:Bank:Checking")
 * @returns Either the account type, or a string with the error if unrecognized
 */
export function getAccountType(account: string): E.Either<string, AccountType> {
  const type = getAccountTypeUnchecked(account);
  return type in AccountType ? E.right(type) : GetAccountTypeError;
}

/**
 * Similar getAccountType, but doesn't check the validity of the result.
 *
 * Only use this when the account has already been validated.
 */
export function getAccountTypeUnchecked(account: string): AccountType {
  return account.split(':', 1)[0] as AccountType;
}

/**
 * Enum representing the possible normal-balance sides.
 */
export enum NormalBalanceSide {
  /** Normal balance is on the debit side. */
  Debit = 'debit',
  /** Normal balance is on the credit side. */
  Credit = 'credit',
}

const DEFAULT_NORMAL_BALANCE: Readonly<Record<AccountType, NormalBalanceSide>> =
  {
    Assets: NormalBalanceSide.Debit,
    Liabilities: NormalBalanceSide.Credit,
    Equity: NormalBalanceSide.Credit,
    Income: NormalBalanceSide.Credit,
    Expenses: NormalBalanceSide.Debit,
    Trading: NormalBalanceSide.Credit,
  };

/** Returns the default normal-balance side for the given account type. */
export function getDefaultNormalBalanceSide(
  accountType: AccountType,
): NormalBalanceSide {
  return DEFAULT_NORMAL_BALANCE[accountType];
}

const KnownNormalBalanceSidesStr = Object.values(NormalBalanceSide)
  .map(x => [`'${x}'`])
  .join(', ');
const ParseNormalBalanceSideError = E.left(
  `expected one of ${KnownNormalBalanceSidesStr}`,
);

/**
 * Parses a NormalBalanceSide from a string.
 *
 * @param value The value to parse.
 * @returns Either the parsed NormalBalanceSide, or a string with the error.
 */
export function parseNormalBalanceSide(
  value: string,
): E.Either<string, NormalBalanceSide> {
  switch (value) {
    case NormalBalanceSide.Debit:
      return E.of(NormalBalanceSide.Debit);
    case NormalBalanceSide.Credit:
      return E.of(NormalBalanceSide.Credit);
    default:
      return ParseNormalBalanceSideError;
  }
}
