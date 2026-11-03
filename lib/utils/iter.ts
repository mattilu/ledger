/**
 * Returns a pair of independent, lazy iterators over the same `iterable`.
 *
 * Both iterators share a single source and buffer, so items are pulled from the
 * source only when needed and buffered until consumed by the other iterator.
 *
 * @param iterable Iterable to tee.
 * @returns A tuple of two independent generators over `iterable`.
 */
export function tee<T>(
  iterable: Iterable<T>,
): [Generator<T, void, unknown>, Generator<T, void, unknown>] {
  const iterator = iterable[Symbol.iterator]();
  const buffer: T[] = [];

  let tailBitMap: 1 | 2 | 3 = 3;
  let finished = false;

  function* makeIterator(idx: 1 | 2): Generator<T, void, unknown> {
    while (true) {
      // We're at the tail of the buffer, pull one item from source.
      if (tailBitMap & idx) {
        if (finished) {
          return;
        }

        const next = iterator.next();
        if (next.done) {
          finished = true;
          return;
        }

        // Before, we could have been the only one at tail, or both at tail.
        // Now, we're the only one at tail.
        tailBitMap = idx;

        buffer.push(next.value);
        yield next.value;
      } else {
        // We're not at the tail of the buffer. Then, we must be at the
        // beginning. Consume one item.
        const value = buffer.shift()!;

        // If buffer gets empty, both become at tail.
        if (buffer.length === 0) {
          tailBitMap = 3;
        }

        yield value;
      }
    }
  }

  return [makeIterator(1), makeIterator(2)];
}

/**
 * Yields zero-based index/value pairs from the `iterable`.
 *
 * @param iterable Iterable to enumerate.
 * @returns A generator yielding `[index, value]` tuples.
 */
export function* enumerate<T>(
  iterable: Iterable<T>,
): Generator<[number, T], void, unknown> {
  let i = 0;
  for (const item of iterable) {
    yield [i++, item];
  }
}

/**
 * Yields pairs of values from two iterables, stopping when either is exhausted.
 *
 * @param iterableA First iterable to zip.
 * @param iterableB Second iterable to zip.
 * @returns A generator yielding `[valueA, valueB]` tuples.
 */
export function* zip<A, B>(
  iterableA: Iterable<A>,
  iterableB: Iterable<B>,
): Generator<[A, B], void, unknown> {
  const iterA = iterableA[Symbol.iterator]();
  const iterB = iterableB[Symbol.iterator]();

  try {
    while (true) {
      const nextA = iterA.next();
      const nextB = iterB.next();

      if (nextA.done || nextB.done) {
        break;
      }

      yield [nextA.value, nextB.value];
    }
  } finally {
    iterA.return?.();
    iterB.return?.();
  }
}

/**
 * Yields values from `iterable` until `pred` returns `false`.
 *
 * @param iterable Iterable to take values from.
 * @param pred Predicate to test values from the underlying iterable.
 * @returns A generator yielding values for which `pred` returned `true`.
 */
export function* takeWhile<T>(
  iterable: Iterable<T>,
  pred: (value: T) => boolean,
): Generator<T, void, unknown> {
  for (const value of iterable) {
    if (!pred(value)) {
      break;
    }
    yield value;
  }
}
