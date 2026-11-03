import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { enumerate, takeWhile, tee, zip } from './iter.js';

function* infiniteGen(state: { n: number }): Generator<number> {
  while (true) {
    yield state.n++;
  }
}

describe('tee', () => {
  it('returns two independent iterators', () => {
    const src = [1, 2, 3, 4, 5];
    const [itA, itB] = tee(src);

    assert.deepEqual(itA.toArray(), src);
    assert.deepEqual(itB.toArray(), src);
  });

  it('is lazy', () => {
    const state = { n: 0 };
    const [itA, itB] = tee(infiniteGen(state));

    assert.equal(itA.next().value, 0);
    assert.equal(state.n, 1);

    assert.equal(itA.next().value, 1);
    assert.equal(state.n, 2);

    assert.equal(itB.next().value, 0);
    assert.equal(state.n, 2);

    assert.equal(itB.next().value, 1);
    assert.equal(state.n, 2);

    assert.equal(itB.next().value, 2);
    assert.equal(state.n, 3);

    assert.deepEqual(itA.next().value, 2);
    assert.equal(state.n, 3);
  });
});

describe('enumerate', () => {
  it('yields zero-based index and value pairs', () => {
    assert.deepEqual(
      [...enumerate([10, 20, 30])],
      [
        [0, 10],
        [1, 20],
        [2, 30],
      ],
    );
  });

  it('yields nothing for an empty iterable', () => {
    assert.deepEqual([...enumerate([])], []);
  });

  it('is lazy', () => {
    const state = { n: 0 };
    const enumerated = enumerate(infiniteGen(state));

    assert.deepEqual(enumerated.next().value, [0, 0]);
    assert.deepEqual(enumerated.next().value, [1, 1]);
    assert.equal(state.n, 2);
  });
});

describe('zip', () => {
  it('zips two iterables into pairs', () => {
    assert.deepEqual(
      [...zip([1, 2, 3], ['a', 'b', 'c'])],
      [
        [1, 'a'],
        [2, 'b'],
        [3, 'c'],
      ],
    );
  });

  it('stops at the first exhausted iterable', () => {
    assert.deepEqual([...zip([1, 2, 3], [])], []);
    assert.deepEqual([...zip([], [1, 2, 3])], []);
  });

  it('stops at the shorter iterable', () => {
    assert.deepEqual([...zip([1, 2, 3], [10])], [[1, 10]]);
  });

  it('is lazy', () => {
    const stateA = { n: 0 };
    const stateB = { n: 10 };
    const zipped = zip(infiniteGen(stateA), infiniteGen(stateB));

    assert.deepEqual(zipped.next().value, [0, 10]);
    assert.deepEqual(zipped.next().value, [1, 11]);
  });
});

describe('takeWhile', () => {
  it('yields items while the predicate holds', () => {
    assert.deepEqual([...takeWhile([1, 2, 3, 4, 5], x => x < 3)], [1, 2]);
  });

  it('yields nothing when the first item fails', () => {
    assert.deepEqual([...takeWhile([1, 2, 3], x => x < 0)], []);
  });

  it('yields everything when the predicate holds for all items', () => {
    assert.deepEqual([...takeWhile([1, 2, 3], () => true)], [1, 2, 3]);
  });

  it('yields nothing for an empty iterable', () => {
    assert.deepEqual([...takeWhile([], () => true)], []);
  });

  it('is lazy', () => {
    const state = { n: 0 };
    const filtered = takeWhile(infiniteGen(state), x => x < 3);

    assert.equal(filtered.next().value, 0);
    assert.equal(filtered.next().value, 1);
    assert.equal(filtered.next().value, 2);
    assert.equal(state.n, 3);

    assert(filtered.next().done);
    assert.equal(state.n, 4);

    // No more values are pulled after completion.
    assert(filtered.next().done);
    assert.equal(state.n, 4);
  });
});
