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

export const COST_SPEC_WRAP_STYLES = ['compact', 'expanded'] as const;
export type CostSpecWrapStyle = (typeof COST_SPEC_WRAP_STYLES)[number];

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
  readonly costSpecWrapStyle: CostSpecWrapStyle;
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
  costSpecWrapStyle: 'compact',
};

export const MAX_INDENT_WIDTH = 32;
export const MAX_PRINT_WIDTH = 10_000;
export const MAX_ALIGN_COLUMN = 1_000;
export const MAX_MIN_GAP_SPACES = 64;

const KNOWN_KEYS = new Set<string>(Object.keys(DEFAULT_FORMAT_OPTIONS));

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
  );
}

function isIntInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function getOwn(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
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
  const rawIndentWidth = getOwn(record, 'indentWidth');
  if (rawIndentWidth !== undefined) {
    if (!isIntInRange(rawIndentWidth, 1, MAX_INDENT_WIDTH)) {
      return E.left(
        new FormatError(
          `'indentWidth' must be an integer between 1 and ${MAX_INDENT_WIDTH}`,
        ),
      );
    }
    indentWidth = rawIndentWidth;
  }

  let printWidth = DEFAULT_FORMAT_OPTIONS.printWidth;
  const rawPrintWidth = getOwn(record, 'printWidth');
  if (rawPrintWidth !== undefined) {
    if (!isIntInRange(rawPrintWidth, 1, MAX_PRINT_WIDTH)) {
      return E.left(
        new FormatError(
          `'printWidth' must be an integer between 1 and ${MAX_PRINT_WIDTH}`,
        ),
      );
    }
    printWidth = rawPrintWidth;
  }

  let alignScope = DEFAULT_FORMAT_OPTIONS.alignScope;
  const rawAlignScope = getOwn(record, 'alignScope');
  if (rawAlignScope !== undefined) {
    if (!isOneOf(rawAlignScope, ALIGN_SCOPES)) {
      return E.left(
        new FormatError(
          `'alignScope' must be one of: ${ALIGN_SCOPES.join(', ')}`,
        ),
      );
    }
    alignScope = rawAlignScope;
  }

  let alignMode = DEFAULT_FORMAT_OPTIONS.alignMode;
  const rawAlignMode = getOwn(record, 'alignMode');
  if (rawAlignMode !== undefined) {
    if (!isOneOf(rawAlignMode, ALIGN_MODES)) {
      return E.left(
        new FormatError(
          `'alignMode' must be one of: ${ALIGN_MODES.join(', ')}`,
        ),
      );
    }
    alignMode = rawAlignMode;
  }

  let alignColumn = DEFAULT_FORMAT_OPTIONS.alignColumn;
  const rawAlignColumn = getOwn(record, 'alignColumn');
  if (rawAlignColumn !== undefined) {
    if (!isIntInRange(rawAlignColumn, 0, MAX_ALIGN_COLUMN)) {
      return E.left(
        new FormatError(
          `'alignColumn' must be an integer between 0 and ${MAX_ALIGN_COLUMN}`,
        ),
      );
    }
    alignColumn = rawAlignColumn;
  }

  let maxAlignColumn = DEFAULT_FORMAT_OPTIONS.maxAlignColumn;
  const rawMaxAlignColumn = getOwn(record, 'maxAlignColumn');
  if (rawMaxAlignColumn !== undefined && rawMaxAlignColumn !== null) {
    if (!isIntInRange(rawMaxAlignColumn, 1, MAX_ALIGN_COLUMN)) {
      return E.left(
        new FormatError(
          `'maxAlignColumn' must be an integer between 1 and ${MAX_ALIGN_COLUMN} or null`,
        ),
      );
    }
    maxAlignColumn = rawMaxAlignColumn;
  }

  if (
    (alignScope === 'file' || alignScope === 'file-grow-only') &&
    alignColumn > 0 &&
    maxAlignColumn !== null &&
    alignColumn > maxAlignColumn
  ) {
    return E.left(
      new FormatError(
        `'alignColumn' (${alignColumn}) cannot exceed 'maxAlignColumn' (${maxAlignColumn})`,
      ),
    );
  }

  let minGapSpaces = DEFAULT_FORMAT_OPTIONS.minGapSpaces;
  const rawMinGapSpaces = getOwn(record, 'minGapSpaces');
  if (rawMinGapSpaces !== undefined) {
    if (!isIntInRange(rawMinGapSpaces, 1, MAX_MIN_GAP_SPACES)) {
      return E.left(
        new FormatError(
          `'minGapSpaces' must be an integer between 1 and ${MAX_MIN_GAP_SPACES}`,
        ),
      );
    }
    minGapSpaces = rawMinGapSpaces;
  }

  let alignTrailingComments = DEFAULT_FORMAT_OPTIONS.alignTrailingComments;
  const rawAlignTrailingComments = getOwn(record, 'alignTrailingComments');
  if (rawAlignTrailingComments !== undefined) {
    if (typeof rawAlignTrailingComments !== 'boolean') {
      return E.left(
        new FormatError("'alignTrailingComments' must be a boolean"),
      );
    }
    alignTrailingComments = rawAlignTrailingComments;
  }

  let thousandsSeparator = DEFAULT_FORMAT_OPTIONS.thousandsSeparator;
  const rawThousandsSeparator = getOwn(record, 'thousandsSeparator');
  if (rawThousandsSeparator !== undefined) {
    if (!isOneOf(rawThousandsSeparator, THOUSANDS_SEPARATOR_MODES)) {
      return E.left(
        new FormatError(
          `'thousandsSeparator' must be one of: ${THOUSANDS_SEPARATOR_MODES.join(', ')}`,
        ),
      );
    }
    thousandsSeparator = rawThousandsSeparator;
  }

  let transactionFlagStyle = DEFAULT_FORMAT_OPTIONS.transactionFlagStyle;
  const rawTransactionFlagStyle = getOwn(record, 'transactionFlagStyle');
  if (rawTransactionFlagStyle !== undefined) {
    if (!isOneOf(rawTransactionFlagStyle, TRANSACTION_FLAG_STYLES)) {
      return E.left(
        new FormatError(
          `'transactionFlagStyle' must be one of: ${TRANSACTION_FLAG_STYLES.join(', ')}`,
        ),
      );
    }
    transactionFlagStyle = rawTransactionFlagStyle;
  }

  let currencyKeywordStyle = DEFAULT_FORMAT_OPTIONS.currencyKeywordStyle;
  const rawCurrencyKeywordStyle = getOwn(record, 'currencyKeywordStyle');
  if (rawCurrencyKeywordStyle !== undefined) {
    if (!isOneOf(rawCurrencyKeywordStyle, CURRENCY_KEYWORD_STYLES)) {
      return E.left(
        new FormatError(
          `'currencyKeywordStyle' must be one of: ${CURRENCY_KEYWORD_STYLES.join(', ')}`,
        ),
      );
    }
    currencyKeywordStyle = rawCurrencyKeywordStyle;
  }

  let trailingComma = DEFAULT_FORMAT_OPTIONS.trailingComma;
  const rawTrailingComma = getOwn(record, 'trailingComma');
  if (rawTrailingComma !== undefined) {
    if (!isOneOf(rawTrailingComma, TRAILING_COMMA_STYLES)) {
      return E.left(
        new FormatError(
          `'trailingComma' must be one of: ${TRAILING_COMMA_STYLES.join(', ')}`,
        ),
      );
    }
    trailingComma = rawTrailingComma;
  }

  let costSpecWrapStyle = DEFAULT_FORMAT_OPTIONS.costSpecWrapStyle;
  const rawCostSpecWrapStyle = getOwn(record, 'costSpecWrapStyle');
  if (rawCostSpecWrapStyle !== undefined) {
    if (!isOneOf(rawCostSpecWrapStyle, COST_SPEC_WRAP_STYLES)) {
      return E.left(
        new FormatError(
          `'costSpecWrapStyle' must be one of: ${COST_SPEC_WRAP_STYLES.join(', ')}`,
        ),
      );
    }
    costSpecWrapStyle = rawCostSpecWrapStyle;
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
    costSpecWrapStyle,
  });
}
