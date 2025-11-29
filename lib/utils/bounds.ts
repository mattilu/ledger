/**
 * Searches for the first element in the partitioned range `[lo, hi)` for which
 * `pred(value)` returns `false`.
 *
 * Requires the input range to be partitioned with respect to `pred`, otherwise
 * behavior is undefined. The input is partitioned iff there exists an integer
 * `n` such that for all `i` in `[lo, hi)`, `pred(items[i])` is `true` iff
 * `i < n`.
 *
 * @param items Array of items to search.
 * @param pred Partitioning predicate.
 * @param lo Starting index to search (included). Defaults to 0.
 * @param hi Ending index to search (excluded). Defaults to `items.length`.
 * @returns The index of the first element in the range `[lo, hi)` for which
 *  `pred` returns `false`, or `hi` if not found.
 */
export function partitionPoint<T>(
  items: readonly T[],
  pred: (elem: T) => boolean,
  lo = 0,
  hi = items.length,
): number {
  while (lo < hi) {
    const i = (lo + hi) >>> 1;
    if (pred(items[i])) {
      lo = i + 1;
    } else {
      hi = i;
    }
  }
  return hi;
}

/**
 * Partitions the input array at its partition point, and returns the two
 * partitions. See `partitionPoint` for details.
 *
 * @param items Array to partition.
 * @param pred Partitioning predicate.
 * @returns A tuple with the partitioned arrays. The first item is the partition
 *   which satisfies the predicate, the second item is the one that doesn't.
 */
export function partition<T>(items: readonly T[], pred: (elem: T) => boolean) {
  const point = partitionPoint(items, pred);
  return [items.slice(0, point), items.slice(point)];
}

/**
 * Returns the partition of the input array that satisfies the predicate.
 *
 * @param items Array to partition.
 * @param pred Partitioning predicate.
 * @returns The partition which satisfies the predicate.
 */
export function partitionLo<T>(
  items: readonly T[],
  pred: (elem: T) => boolean,
) {
  return items.slice(0, partitionPoint(items, pred));
}

/**
 * Returns the partition of the input array that doesn't satisfy the predicate.
 *
 * @param items Array to partition.
 * @param pred Partitioning predicate.
 * @returns The partition which doesn't satisfy the predicate.
 */
export function partitionHi<T>(
  items: readonly T[],
  pred: (elem: T) => boolean,
) {
  return items.slice(partitionPoint(items, pred));
}

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
  return partitionPoint(items, elem => cmp(elem, value), lo, hi);
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
  return partitionPoint(items, elem => !cmp(value, elem), lo, hi);
}
