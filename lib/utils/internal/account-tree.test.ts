import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { formatTree, makeAccountTree, Node } from './account-tree.js';

await describe('makeAccountTree', async () => {
  await it('works', () => {
    const data = [
      { account: 'Assets:Bank:Foo', amount: 2000 },
      { account: 'Assets:Bank:Bar', amount: 1000 },
      { account: 'Expenses:Car:Fuel', amount: 100 },
      { account: 'Expenses:Groceries', amount: 200 },
      { account: 'Expenses:Rent', amount: 500 },
      { account: 'Income:Bonus', amount: -300 },
      { account: 'Income:Salary', amount: -3500 },
    ];

    const got = makeAccountTree(
      new Map(data.map(x => [x.account, x])),
      x => x.amount,
      (nodeValue, childValues) =>
        childValues.reduce((a, b) => a + b, nodeValue ?? 0),
    );

    const want: Node<number> = {
      name: '',
      data: 0,
      children: [
        {
          name: 'Assets',
          data: 3000,
          children: [
            {
              name: 'Bank',
              data: 3000,
              children: [
                {
                  name: 'Foo',
                  data: 2000,
                  children: [],
                },
                {
                  name: 'Bar',
                  data: 1000,
                  children: [],
                },
              ],
            },
          ],
        },
        {
          name: 'Expenses',
          data: 800,
          children: [
            {
              name: 'Car',
              data: 100,
              children: [
                {
                  name: 'Fuel',
                  data: 100,
                  children: [],
                },
              ],
            },
            {
              name: 'Groceries',
              data: 200,
              children: [],
            },
            {
              name: 'Rent',
              data: 500,
              children: [],
            },
          ],
        },
        {
          name: 'Income',
          data: -3800,
          children: [
            {
              name: 'Bonus',
              data: -300,
              children: [],
            },
            {
              name: 'Salary',
              data: -3500,
              children: [],
            },
          ],
        },
      ],
    };

    assert.deepEqual(got, want);
  });
});

await describe('formatTree', async () => {
  const testCases: Array<{
    name: string;
    root: Node<number[]>;
    want: string;
  }> = [
    {
      name: 'root empty',
      root: { name: '', data: [], children: [] },
      want: '╿',
    },
    {
      name: 'root 1 entry',
      root: { name: '', data: [1], children: [] },
      want: '\
╿    1',
    },
    {
      name: 'root 2 entries',
      root: { name: '', data: [1, 2], children: [] },
      want: `\
╿    1
└    2`,
    },
    {
      name: 'root 3 entries',
      root: { name: '', data: [1, 2, 3], children: [] },
      want: `\
╿    1
│    2
└    3`,
    },
    {
      name: 'root empty, 1 child empty',
      root: {
        name: '',
        data: [],
        children: [
          {
            name: 'Foo',
            data: [],
            children: [],
          },
        ],
      },
      want: `\
╿
└─ Foo`,
    },
    {
      name: 'root empty, 2 children empty',
      root: {
        name: '',
        data: [],
        children: [
          {
            name: 'Foo',
            data: [],
            children: [],
          },
          {
            name: 'Bar',
            data: [],
            children: [],
          },
        ],
      },
      want: `\
╿
├─ Foo
└─ Bar`,
    },
    {
      name: 'root empty, children with data',
      root: {
        name: '',
        data: [],
        children: [
          {
            name: 'Foo',
            data: [1, 2, 3],
            children: [],
          },
          {
            name: 'Bar',
            data: [4, 5],
            children: [],
          },
          {
            name: 'Baz',
            data: [6, 7],
            children: [],
          },
        ],
      },
      want: `\
╿
├─ Foo  1
│  │    2
│  └    3
├─ Bar  4
│  └    5
└─ Baz  6
   └    7`,
    },
    {
      name: 'root, children and grandchildren empty',
      root: {
        name: '',
        data: [],
        children: [
          {
            name: 'Foo',
            data: [],
            children: [
              {
                name: 'Alpha',
                data: [],
                children: [],
              },
              {
                name: 'Bravo',
                data: [],
                children: [],
              },
              {
                name: 'Charlie',
                data: [],
                children: [],
              },
            ],
          },
          {
            name: 'Bar',
            data: [],
            children: [
              {
                name: 'One',
                data: [],
                children: [],
              },
              {
                name: 'Two',
                data: [],
                children: [],
              },
              {
                name: 'Three',
                data: [],
                children: [],
              },
            ],
          },
          {
            name: 'Baz',
            data: [],
            children: [
              {
                name: 'Alpha',
                data: [],
                children: [],
              },
              {
                name: 'Beta',
                data: [],
                children: [],
              },
              {
                name: 'Gamma',
                data: [],
                children: [],
              },
            ],
          },
        ],
      },
      want: `\
╿
├─ Foo
│  ├─ Alpha
│  ├─ Bravo
│  └─ Charlie
├─ Bar
│  ├─ One
│  ├─ Two
│  └─ Three
└─ Baz
   ├─ Alpha
   ├─ Beta
   └─ Gamma`,
    },
    {
      name: 'root, children and grandchildren with data',
      root: {
        name: '',
        data: [66],
        children: [
          {
            name: 'Foo',
            data: [15],
            children: [
              {
                name: 'Alpha',
                data: [1, 2],
                children: [],
              },
              {
                name: 'Bravo',
                data: [3],
                children: [],
              },
              {
                name: 'Charlie',
                data: [4, 5],
                children: [],
              },
            ],
          },
          {
            name: 'Bar',
            data: [2, 5, 13],
            children: [
              {
                name: 'One',
                data: [1, 1, 2],
                children: [],
              },
              {
                name: 'Two',
                data: [3],
                children: [],
              },
              {
                name: 'Three',
                data: [5, 8],
                children: [],
              },
            ],
          },
          {
            name: 'Baz',
            data: [3],
            children: [
              {
                name: 'Alpha',
                data: [1],
                children: [],
              },
              {
                name: 'Beta',
                data: [2, 4],
                children: [],
              },
              {
                name: 'Gamma',
                data: [8, 16],
                children: [],
              },
            ],
          },
        ],
      },
      want: `\
╿              66
├─ Foo         15
│  ├─ Alpha    1
│  │  └        2
│  ├─ Bravo    3
│  └─ Charlie  4
│     └        5
├─ Bar         2
│  │           5
│  │           13
│  ├─ One      1
│  │  │        1
│  │  └        2
│  ├─ Two      3
│  └─ Three    5
│     └        8
└─ Baz         3
   ├─ Alpha    1
   ├─ Beta     2
   │  └        4
   └─ Gamma    8
      └        16`,
    },
  ];

  for (const t of testCases) {
    await it(t.name, () => {
      const got = formatTree(t.root, node => node.data.map(x => x.toString()));
      assert.deepEqual(got, t.want);
    });
  }
});
