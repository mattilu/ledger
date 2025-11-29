import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  lowerBound,
  partition,
  partitionHi,
  partitionLo,
  partitionPoint,
  upperBound,
} from './bounds.js';

await describe('partitions', async () => {
  await describe('partitionPoint', async () => {
    interface TestCase<T> {
      readonly name: string;
      readonly items: T[];
      readonly pred: (item: T) => boolean;
      readonly wantPoint: number;
      readonly wantLo: T[];
      readonly wantHi: T[];
    }

    const tests: Array<TestCase<number>> = [
      {
        name: 'empty-items',
        items: [],
        pred: (item: number) => item < 2,
        wantPoint: 0,
        wantLo: [],
        wantHi: [],
      },
      {
        name: 'less-than',
        items: [0, 1, 2, 2, 2, 3, 3, 4, 5],
        pred: (item: number) => item < 2,
        wantPoint: 2,
        wantLo: [0, 1],
        wantHi: [2, 2, 2, 3, 3, 4, 5],
      },
      {
        name: 'less-than-or-equal',
        items: [0, 1, 2, 2, 2, 3, 3, 4, 5],
        pred: (item: number) => item <= 2,
        wantPoint: 5,
        wantLo: [0, 1, 2, 2, 2],
        wantHi: [3, 3, 4, 5],
      },
      {
        name: 'modulus',
        items: [0, 6, 2, 4, 5, 3, 1],
        pred: (item: number) => item % 2 === 0,
        wantPoint: 4,
        wantLo: [0, 6, 2, 4],
        wantHi: [5, 3, 1],
      },
      {
        name: 'before-first-item',
        items: [0, 1, 2, 2, 2, 3, 3, 4, 5],
        pred: (item: number) => item < 0,
        wantPoint: 0,
        wantLo: [],
        wantHi: [0, 1, 2, 2, 2, 3, 3, 4, 5],
      },
      {
        name: 'after-last-item',
        items: [0, 1, 2, 2, 2, 3, 3, 4, 5],
        pred: (item: number) => item < 10,
        wantPoint: 9,
        wantLo: [0, 1, 2, 2, 2, 3, 3, 4, 5],
        wantHi: [],
      },
    ];

    for (const t of tests) {
      await test(`partitionPoint [${t.name}]`, () => {
        const got = partitionPoint(t.items, t.pred);
        assert.equal(got, t.wantPoint);
      });
    }

    for (const t of tests) {
      await test(`partition [${t.name}]`, () => {
        const got = partition(t.items, t.pred);
        assert.deepEqual(got, [t.wantLo, t.wantHi]);
      });
    }

    for (const t of tests) {
      await test(`partitionLo [${t.name}]`, () => {
        const got = partitionLo(t.items, t.pred);
        assert.deepEqual(got, t.wantLo);
      });
    }

    for (const t of tests) {
      await test(`partitionHi [${t.name}]`, () => {
        const got = partitionHi(t.items, t.pred);
        assert.deepEqual(got, t.wantHi);
      });
    }
  });
});

await describe('bounds', async () => {
  interface TestCase<T> {
    readonly items: T[];
    readonly value: T;
    readonly cmp: readonly [string, (a: T, b: T) => boolean];
    readonly want: number;
    readonly lo?: number;
    readonly hi?: number;
  }

  const items = [0, 1, 2, 3, 4, 5];
  const itemsWithRep = [0, 1, 2, 2, 2, 2, 3, 4];
  const lt = ['lt', (a: number, b: number) => a < b] as const;
  const lte = ['lte', (a: number, b: number) => a <= b] as const;

  async function runTest(
    fnName: string,
    fn: typeof lowerBound | typeof upperBound,
    t: TestCase<number>,
  ) {
    let testParams = `[${t.items.join(', ')}], ${t.value}, ${t.cmp[0]}`;
    if (t.lo !== undefined) {
      testParams += `, lo = ${t.lo}`;
    }
    if (t.hi !== undefined) {
      testParams += `, hi = ${t.hi}`;
    }
    await test(`${fnName}(${testParams}) == ${t.want}`, () => {
      assert.equal(fn(t.items, t.value, t.cmp[1], t.lo, t.hi), t.want);
    });
  }

  await describe('lowerBound', async () => {
    const tests: TestCase<number>[] = [
      ...items.map(i => ({
        items,
        value: i,
        cmp: lt,
        want: i,
      })),
      ...items.map(i => ({
        items,
        value: i,
        cmp: lte,
        want: i + 1,
      })),
      { items: itemsWithRep, value: 2, cmp: lt, want: 2 },
      { items: itemsWithRep, value: 2, cmp: lte, want: 6 },
      { items: itemsWithRep, value: 2, cmp: lt, lo: 3, want: 3 },
      { items: itemsWithRep, value: 2, cmp: lte, hi: 5, want: 5 },
    ];

    for (const t of tests) {
      await runTest('lowerBound', lowerBound, t);
    }
  });

  await describe('upperBound', async () => {
    const tests: TestCase<number>[] = [
      ...items.map(i => ({
        items,
        value: i,
        cmp: lt,
        want: i + 1,
      })),
      ...items.map(i => ({
        items,
        value: i,
        cmp: lte,
        want: i,
      })),
      { items: itemsWithRep, value: 2, cmp: lt, want: 6 },
      { items: itemsWithRep, value: 2, cmp: lte, want: 2 },
      { items: itemsWithRep, value: 2, cmp: lt, hi: 5, want: 5 },
      { items: itemsWithRep, value: 2, cmp: lte, lo: 3, want: 3 },
    ];

    for (const t of tests) {
      await runTest('upperBound', upperBound, t);
    }
  });
});
