import { either as E } from 'fp-ts';

import { FormatError } from './error.js';

export const ALIGN_SCOPES = [
  'none',
  'directive',
  'file',
  'file-grow-only',
  'fixed',
] as const;
export type AlignScope = (typeof ALIGN_SCOPES)[number];

export const ALIGN_MODES = [
  'currency',
  'decimal',
  'decimal-and-currency',
] as const;
export type AlignMode = (typeof ALIGN_MODES)[number];

export const THOUSANDS_SEPARATOR_MODES = ['preserve', 'add', 'remove'] as const;
export type ThousandsSeparatorMode = (typeof THOUSANDS_SEPARATOR_MODES)[number];

export const TRANSACTION_FLAG_STYLES = ['preserve', 'star', 'txn'] as const;
export type TransactionFlagStyle = (typeof TRANSACTION_FLAG_STYLES)[number];

export const CURRENCY_KEYWORD_STYLES = [
  'preserve',
  'currency',
  'commodity',
] as const;
export type CurrencyKeywordStyle = (typeof CURRENCY_KEYWORD_STYLES)[number];

export const TRAILING_COMMA_STYLES = ['multiline', 'always', 'never'] as const;
export type TrailingCommaStyle = (typeof TRAILING_COMMA_STYLES)[number];

export interface FormatOptions {
  readonly indentWidth: number;
  readonly printWidth: number;
  readonly alignScope: AlignScope;
  readonly alignMode: AlignMode;
  readonly alignColumn: number;
  readonly maxAlignColumn: number | null;
  readonly minGapSpaces: number;
  readonly alignTrailingComments: boolean;
  readonly thousandsSeparator: ThousandsSeparatorMode;
  readonly transactionFlagStyle: TransactionFlagStyle;
  readonly currencyKeywordStyle: CurrencyKeywordStyle;
  readonly trailingComma: TrailingCommaStyle;
}

export const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  indentWidth: 2,
  printWidth: 88,
  alignScope: 'directive',
  alignMode: 'currency',
  alignColumn: 0,
  maxAlignColumn: null,
  minGapSpaces: 2,
  alignTrailingComments: false,
  thousandsSeparator: 'preserve',
  transactionFlagStyle: 'preserve',
  currencyKeywordStyle: 'preserve',
  trailingComma: 'multiline',
};

const KNOWN_KEYS = new Set<string>(Object.keys(DEFAULT_FORMAT_OPTIONS));

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
  );
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Validates and merges raw formatter options with `DEFAULT_FORMAT_OPTIONS`.
 *
 * @param raw Raw configuration object (e.g., parsed `.ledgerfmt.json` or
 *   partial user options).
 * @returns Either the validated `FormatOptions`, or a `FormatError` if any
 *   option name or value is invalid.
 */
export function resolveFormatOptions(
  raw?: unknown,
): E.Either<FormatError, FormatOptions> {
  if (raw === undefined) {
    return E.right(DEFAULT_FORMAT_OPTIONS);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return E.left(
      new FormatError('Formatter configuration must be a JSON object'),
    );
  }

  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.has(key)) {
      return E.left(
        new FormatError(`Unknown formatter configuration option '${key}'`),
      );
    }
  }

  let indentWidth = DEFAULT_FORMAT_OPTIONS.indentWidth;
  if (record.indentWidth !== undefined) {
    if (!isPositiveInt(record.indentWidth)) {
      return E.left(
        new FormatError("'indentWidth' must be a positive integer"),
      );
    }
    indentWidth = record.indentWidth;
  }

  let printWidth = DEFAULT_FORMAT_OPTIONS.printWidth;
  if (record.printWidth !== undefined) {
    if (!isPositiveInt(record.printWidth)) {
      return E.left(new FormatError("'printWidth' must be a positive integer"));
    }
    printWidth = record.printWidth;
  }

  let alignScope = DEFAULT_FORMAT_OPTIONS.alignScope;
  if (record.alignScope !== undefined) {
    if (!isOneOf(record.alignScope, ALIGN_SCOPES)) {
      return E.left(
        new FormatError(
          `'alignScope' must be one of: ${ALIGN_SCOPES.join(', ')}`,
        ),
      );
    }
    alignScope = record.alignScope;
  }

  let alignMode = DEFAULT_FORMAT_OPTIONS.alignMode;
  if (record.alignMode !== undefined) {
    if (!isOneOf(record.alignMode, ALIGN_MODES)) {
      return E.left(
        new FormatError(
          `'alignMode' must be one of: ${ALIGN_MODES.join(', ')}`,
        ),
      );
    }
    alignMode = record.alignMode;
  }

  let alignColumn = DEFAULT_FORMAT_OPTIONS.alignColumn;
  if (record.alignColumn !== undefined) {
    if (!isNonNegativeInt(record.alignColumn)) {
      return E.left(
        new FormatError("'alignColumn' must be a non-negative integer"),
      );
    }
    alignColumn = record.alignColumn;
  }

  let maxAlignColumn = DEFAULT_FORMAT_OPTIONS.maxAlignColumn;
  if (record.maxAlignColumn !== undefined && record.maxAlignColumn !== null) {
    if (!isPositiveInt(record.maxAlignColumn)) {
      return E.left(
        new FormatError("'maxAlignColumn' must be a positive integer or null"),
      );
    }
    maxAlignColumn = record.maxAlignColumn;
  }

  let minGapSpaces = DEFAULT_FORMAT_OPTIONS.minGapSpaces;
  if (record.minGapSpaces !== undefined) {
    if (!isPositiveInt(record.minGapSpaces)) {
      return E.left(
        new FormatError("'minGapSpaces' must be a positive integer"),
      );
    }
    minGapSpaces = record.minGapSpaces;
  }

  let alignTrailingComments = DEFAULT_FORMAT_OPTIONS.alignTrailingComments;
  if (record.alignTrailingComments !== undefined) {
    if (typeof record.alignTrailingComments !== 'boolean') {
      return E.left(
        new FormatError("'alignTrailingComments' must be a boolean"),
      );
    }
    alignTrailingComments = record.alignTrailingComments;
  }

  let thousandsSeparator = DEFAULT_FORMAT_OPTIONS.thousandsSeparator;
  if (record.thousandsSeparator !== undefined) {
    if (!isOneOf(record.thousandsSeparator, THOUSANDS_SEPARATOR_MODES)) {
      return E.left(
        new FormatError(
          `'thousandsSeparator' must be one of: ${THOUSANDS_SEPARATOR_MODES.join(', ')}`,
        ),
      );
    }
    thousandsSeparator = record.thousandsSeparator;
  }

  let transactionFlagStyle = DEFAULT_FORMAT_OPTIONS.transactionFlagStyle;
  if (record.transactionFlagStyle !== undefined) {
    if (!isOneOf(record.transactionFlagStyle, TRANSACTION_FLAG_STYLES)) {
      return E.left(
        new FormatError(
          `'transactionFlagStyle' must be one of: ${TRANSACTION_FLAG_STYLES.join(', ')}`,
        ),
      );
    }
    transactionFlagStyle = record.transactionFlagStyle;
  }

  let currencyKeywordStyle = DEFAULT_FORMAT_OPTIONS.currencyKeywordStyle;
  if (record.currencyKeywordStyle !== undefined) {
    if (!isOneOf(record.currencyKeywordStyle, CURRENCY_KEYWORD_STYLES)) {
      return E.left(
        new FormatError(
          `'currencyKeywordStyle' must be one of: ${CURRENCY_KEYWORD_STYLES.join(', ')}`,
        ),
      );
    }
    currencyKeywordStyle = record.currencyKeywordStyle;
  }

  let trailingComma = DEFAULT_FORMAT_OPTIONS.trailingComma;
  if (record.trailingComma !== undefined) {
    if (!isOneOf(record.trailingComma, TRAILING_COMMA_STYLES)) {
      return E.left(
        new FormatError(
          `'trailingComma' must be one of: ${TRAILING_COMMA_STYLES.join(', ')}`,
        ),
      );
    }
    trailingComma = record.trailingComma;
  }

  return E.right({
    indentWidth,
    printWidth,
    alignScope,
    alignMode,
    alignColumn,
    maxAlignColumn,
    minGapSpaces,
    alignTrailingComments,
    thousandsSeparator,
    transactionFlagStyle,
    currencyKeywordStyle,
    trailingComma,
  });
}
