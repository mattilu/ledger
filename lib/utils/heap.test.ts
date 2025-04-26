import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { isHeap, makeHeap, popHeap } from './heap.js';

function makeArray(length: number) {
  const items: number[] = [];
  for (let i = 0; i < length; ++i) {
    items.push(Math.floor(Math.random() * 1024));
  }
  return items;
}

const lt = (a: number, b: number) => a < b;

await describe('isHeap', async () => {
  const tests: Array<{ name: string; items: number[]; want: boolean }> = [
    { name: 'empty', items: [], want: true },
    { name: 'singleton', items: [1], want: true },
    { name: 'two-items-asc', items: [1, 2], want: false },
    { name: 'two-items-desc', items: [2, 1], want: true },
    { name: 'sorted-asc', items: [1, 2, 3, 4, 5, 6, 7, 8, 9], want: false },
    { name: 'sorted-desc', items: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], want: true },
    { name: 'heap', items: [10, 7, 9, 5, 2, 8, 6, 4, 3, 1], want: true },
    { name: 'not-heap', items: [10, 7, 9, 4, 2, 8, 6, 5, 3, 1], want: false },
    { name: 'repeated-elements', items: [10, 10, 10], want: true },
  ];

  for (const t of tests) {
    await test(t.name, () => {
      assert.equal(isHeap(t.items, lt), t.want);
    });
  }
});

await describe('makeHeap', async () => {
  const tests: Array<{ name: string; items: number[]; want: number[] }> = [
    { name: 'empty', items: [], want: [] },
    { name: 'singleton', items: [1], want: [1] },
    { name: 'two-items-asc', items: [1, 2], want: [2, 1] },
    { name: 'two-items-desc', items: [2, 1], want: [2, 1] },
  ];

  for (const t of tests) {
    await test(t.name, () => {
      const items = t.items.slice();
      makeHeap(items, lt);
      assert.deepEqual(items, t.want);
    });
  }

  const randomArrays = [
    makeArray(10),
    makeArray(100),
    makeArray(1000),
    makeArray(10000),
    makeArray(100000),
    makeArray(1000000),
  ];

  await describe('invariants', async () => {
    for (const arr of randomArrays) {
      await test(`isHeap returns true after makeHeap [${arr.length}]`, () => {
        const items = arr.slice();
        makeHeap(items, lt);
        assert(isHeap(items, lt));
      });
    }
    for (const arr of randomArrays) {
      await test(`makeHeap is a no-op after makeHeap [${arr.length}]`, () => {
        const items = arr.slice();
        makeHeap(items, lt);
        const items1 = items.slice();
        makeHeap(items1, lt);
        assert.deepEqual(items1, items);
      });
    }
  });
});

await describe('popHeap', async () => {
  const tests: Array<{ name: string; items: number[]; want: number[] }> = [
    { name: 'empty', items: [], want: [] },
    { name: 'singleton', items: [1], want: [1] },
    { name: 'two-items-desc', items: [2, 1], want: [1, 2] },
    { name: 'repeated-elements', items: [10, 10, 10], want: [10, 10, 10] },
  ];

  for (const t of tests) {
    await test(t.name, () => {
      const items = t.items.slice();
      assert(isHeap(items, lt), 'invalid test setup, input is not a heap');

      popHeap(items, lt);

      assert.deepEqual(items, t.want);
    });
  }

  const randomArrays = [
    makeArray(5),
    makeArray(8),
    makeArray(10),
    makeArray(13),
    makeArray(16),
    makeArray(31),
    makeArray(32),
    makeArray(33),
    makeArray(40),
    makeArray(100),
  ];

  await describe('invariants', async () => {
    for (const arr of randomArrays) {
      await test(`swaps the first item to the end of the array [${arr.length}]`, () => {
        const items = arr.slice();
        makeHeap(items, lt);

        const first = items[0];
        popHeap(items, lt);
        const got = items.pop();

        assert(got === first);
      });
    }

    for (const arr of randomArrays) {
      await test(`isHeap returns true on the reduced array [${arr.length}]`, () => {
        const items = arr.slice();
        makeHeap(items, lt);

        popHeap(items, lt);
        assert(!isHeap(items, lt));
        assert(isHeap(items, lt, 0, items.length - 1));
      });
    }
  });
});
