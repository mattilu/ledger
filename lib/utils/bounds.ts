/**
 * Searches for the first element in the partitioned range `[lo, hi)` for which
 * `cmp(elem, value)` returns `false`.
 *
 * Requires the input range to be partitioned with respect to `cmp(*, value)`,
 * otherwise behavior is undefined. The input is partitioned iff there exists
 * an integer `n` such that for all `i` in `[lo, hi)`, `f(items[i])` is true iff
 * `i < n`.
 *
 * @param items Array of items to search.
 * @param value Value to search.
 * @param cmp Comparation function.
 * @param lo Starting index to search (included). Defaults to 0.
 * @param hi Ending index to search (excluded). Defaults to `items.length`.
 * @returns The index of the first element in the range `[lo, hi)` for which
 *  `cmp(items[i], value)` returns `true`, or `hi` if not found.
 */
export function lowerBound<T, A>(
  items: readonly T[],
  value: A,
  cmp: (elem: T, value: A) => boolean,
  lo = 0,
  hi = items.length,
): number {
  while (lo < hi) {
    const i = (lo + hi) >>> 1;
    if (cmp(items[i], value)) {
      lo = i + 1;
    } else {
      hi = i;
    }
  }
  return hi;
}

/**
 * Searches for the first element in the partitioned range `[lo, hi)` for which
 * `cmp(value, elem)` returns `true`.
 *
 * Requires the input range to be partitioned with respect to `cmp(value, *)`,
 * otherwise behavior is undefined. The input is partitioned iff there exists
 * an integer `n` such that for all `i` in `[lo, hi)`, `f(items[i])` is true iff
 * `i < n`.
 *
 * @param items Array of items to search.
 * @param value Value to search.
 * @param cmp Comparation function.
 * @param lo Starting index to search (included). Defaults to 0.
 * @param hi Ending index to search (excluded). Defaults to `items.length`.
 * @returns The index of the first element in the range `[lo, hi)` for which
 *   `cmp(value, items[i])` returns `true`, or `hi` if not found.
 */
export function upperBound<T, A>(
  items: readonly T[],
  value: A,
  cmp: (value: A, elem: T) => boolean,
  lo = 0,
  hi = items.length,
): number {
  while (lo < hi) {
    const i = (lo + hi) >>> 1;
    if (cmp(value, items[i])) {
      hi = i;
    } else {
      lo = i + 1;
    }
  }
  return hi;
}
