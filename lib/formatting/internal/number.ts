import { ThousandsSeparatorMode } from '../options.js';

/**
 * Formats thousands separators in a raw `NumberLiteral` token string.
 *
 * Preserves exact fractional digits and trailing decimal points without
 * rounding or re-scaling.
 *
 * @param rawText Original `NumberLiteral` token text.
 * @param mode Thousands-separator policy (`preserve`, `add`, or `remove`).
 * @returns The formatted number literal string.
 */
export function formatNumberLiteral(
  rawText: string,
  mode: ThousandsSeparatorMode,
): string {
  if (mode === 'preserve') {
    return rawText;
  }

  const stripped = rawText.replaceAll(',', '');
  if (mode === 'remove') {
    return stripped;
  }

  const sign = stripped.startsWith('-') ? '-' : '';
  const unsigned = sign ? stripped.slice(1) : stripped;
  const dotIdx = unsigned.indexOf('.');
  const intDigits = dotIdx === -1 ? unsigned : unsigned.slice(0, dotIdx);
  const fracSuffix = dotIdx === -1 ? '' : unsigned.slice(dotIdx);

  const groupedInt = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${groupedInt}${fracSuffix}`;
}

/**
 * Splits a formatted expression into `(intPart, fracPart)` for alignment.
 *
 * Non-decimal literals and compound expressions return `fracPart = ''`.
 *
 * @param formattedExpr Rendered amount expression string.
 * @returns Integer/prefix part and decimal suffix part.
 */
export function splitDecimalNumberParts(formattedExpr: string): {
  readonly intPart: string;
  readonly fracPart: string;
} {
  // Plain or unary-signed numeric literal: e.g. "-1,234.50", "+100", "0."
  if (/^[+-]?\d[\d,]*(?:\.\d*)?$/.test(formattedExpr)) {
    const dotIdx = formattedExpr.indexOf('.');
    if (dotIdx !== -1) {
      return {
        intPart: formattedExpr.slice(0, dotIdx),
        fracPart: formattedExpr.slice(dotIdx),
      };
    }
  }
  return { intPart: formattedExpr, fracPart: '' };
}
