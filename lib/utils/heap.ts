type Comparator<T> = (a: T, b: T) => boolean;

/**
 * Checks whether the range `[first, last)` of the `items` array is a max-heap
 * according to `cmp`.
 *
 * @param items Input array to check.
 * @param cmp Comparator function.
 * @param first Fist index of the range to check, inclusive.
 * @param last Last index to check, inclusive.
 * @returns True if the `[first, last)` range of the array is a max-heap.
 */
export function isHeap<T>(
  items: T[],
  cmp: Comparator<T>,
  first = 0,
  last = items.length,
): boolean {
  const size = last - first;
  let parent = 0;
  let child = 1;
  while (child < size) {
    if (cmp(items[first + parent], items[first + child])) {
      return false;
    }

    ++child;
    if (child === size) {
      return true;
    }

    if (cmp(items[first + parent], items[first + child])) {
      return false;
    }

    ++parent;
    child = parent * 2 + 1;
  }
  return true;
}

/**
 * Constructs a max-heap according to `cmp` in the range `[first, last)` of the
 * `items` array.
 *
 * @param items Input array to heapify in place.
 * @param cmp Comparator function.
 * @param first First index of the range to heapify, inclusive.
 * @param last Last index of the range to heapify, exclusive.
 */
export function makeHeap<T>(
  items: T[],
  cmp: Comparator<T>,
  first = 0,
  last = items.length,
) {
  const size = last - first;
  if (size > 1) {
    for (let start = (size - 2) >>> 1; start >= 0; --start) {
      siftDown(items, cmp, first, size, first + start);
    }
  }
}

/**
 * Swaps the `first` and `last-1` values of the heap, and restores the heap
 * property on the `[first, last-1)` subrange.
 *
 * Note that the size of the array is left unchanged, it's up to the caller to
 * actually pop from it if needed, or keep track of the size.
 *
 * @param items Input heap to pop from.
 * @param cmp Comparator function
 * @returns The previous max value on the heap.
 */
export function popHeap<T>(
  items: T[],
  cmp: Comparator<T>,
  first = 0,
  last = items.length,
) {
  const size = last - first;
  if (size > 1) {
    [items[first], items[last - 1]] = [items[last - 1], items[first]];
    siftDown(items, cmp, first, size - 1, 0);
  }
}

function siftDown<T>(
  items: T[],
  cmp: Comparator<T>,
  first: number,
  size: number,
  start: number,
) {
  let child = start - first;
  if (size < 2 || (size - 2) >>> 1 < child) {
    // No more children. We check by division rather than multiplication to
    // avoid possible integer overflows with large arrays
    return;
  }

  // Left child of `start` is at `2 * start + 1`
  // Right child of `start` is at `2 * start + 2`
  child = child * 2 + 1;
  let childAbs = first + child;

  if (child + 1 < size && cmp(items[childAbs], items[childAbs + 1])) {
    // Right child exists, and it's greater than left child, use right child
    ++child;
    ++childAbs;
  }

  if (cmp(items[childAbs], items[start])) {
    // `start` is larger than its largest child, we are in heap order
    return;
  }

  const top = items[start];
  do {
    // We are not in heap order, swap parent with the largest child
    items[start] = items[childAbs];
    start = childAbs;

    if ((size - 2) >>> 1 < child) {
      // No more children
      break;
    }

    // Recompute the child from the updated parent
    child = child * 2 + 1;
    childAbs = first + child;

    if (child + 1 < size && cmp(items[childAbs], items[childAbs + 1])) {
      // Right child exists, and it's greater than left child, use right child
      ++child;
      ++childAbs;
    }

    // Check again we are in heap order
  } while (!cmp(items[childAbs], top));
  items[start] = top;
}
