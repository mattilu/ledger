import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  BottleneckPathAlgebra,
  Graph,
  Path,
  PathAlgebra,
  ReliabilityPathAlgebra,
  ShortestPathAlgebra,
} from './graph.js';

const newGraph = <N = number, E = number>(data?: {
  nodes?: readonly N[];
  edges?: readonly [N, N, E][];
}) => {
  const graph = new Graph<N, E>(x => x);
  data?.nodes?.forEach(node => graph.addNode(node));
  data?.edges?.forEach(([from, to, edge]) => graph.setEdge(from, to, edge));
  return graph;
};

const newUndirectedGraph = <N = number, E = number>(data?: {
  nodes?: readonly N[];
  edges?: readonly [N, N, E][];
}) =>
  newGraph({
    nodes: data?.nodes,
    edges: data?.edges?.flatMap(([a, b, e]) => [
      [a, b, e],
      [b, a, e],
    ]),
  });

describe('Graph', () => {
  describe('#addNode', () => {
    it('adds the node to the graph', () => {
      const graph = newGraph();

      assert.deepEqual(graph.nodes(), []);

      graph.addNode(1);
      graph.addNode(2);

      assert.deepEqual(graph.nodes(), [1, 2]);
    });

    it('returns true iff a new node was added', () => {
      const graph = newGraph();

      assert.equal(graph.addNode(1), true);
      assert.equal(graph.addNode(1), false);
    });

    it('does not replace an existing node', () => {
      const graph = new Graph<{ id: number; name: string }, number, number>(
        x => x.id,
      );

      assert.equal(graph.addNode({ id: 1, name: 'foo' }), true);
      assert.equal(graph.addNode({ id: 1, name: 'bar' }), false);

      assert.deepEqual(graph.nodes(), [{ id: 1, name: 'foo' }]);
    });

    it('works with objects', () => {
      const graph = new Graph<object, number, object>(x => x);

      const n1 = {};
      const n2 = {};

      assert.equal(graph.addNode(n1), true);
      assert.equal(graph.addNode(n2), true);

      const got = graph.nodes();

      assert.equal(got.length, 2);

      // Note: checking for object identity.
      assert.equal(got[0], n1);
      assert.equal(got[1], n2);
    });
  });

  describe('#removeNode', () => {
    it('removes the node from the graph', () => {
      const graph = newGraph();

      graph.addNode(1);
      graph.addNode(2);

      assert.deepEqual(graph.nodes(), [1, 2]);

      graph.removeNode(1);

      assert.deepEqual(graph.nodes(), [2]);
    });

    it('returns true iff an existing node was removed', () => {
      const graph = newGraph();

      graph.addNode(1);
      graph.addNode(2);

      assert.equal(graph.removeNode(3), false);

      assert.equal(graph.removeNode(1), true);
      assert.equal(graph.removeNode(1), false);
    });

    it('removes the edges from and to the node', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);
      graph.setEdge(1, 3, 11);
      graph.setEdge(2, 3, 12);

      assert.deepEqual(graph.edges(), [
        [1, 2, 10],
        [1, 3, 11],
        [2, 3, 12],
      ]);

      graph.removeNode(2);

      assert.deepEqual(graph.edges(), [[1, 3, 11]]);
    });
  });

  describe('#setEdge', () => {
    it('adds an edge between two nodes', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);
      graph.setEdge(2, 3, 11);
      graph.setEdge(3, 1, 12);

      assert.deepEqual(graph.edges(), [
        [1, 2, 10],
        [2, 3, 11],
        [3, 1, 12],
      ]);
    });

    it('also adds the nodes if missing', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);

      assert.deepEqual(graph.nodes(), [1, 2]);
    });

    it('replaces the edge value', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);

      assert.deepEqual(graph.edges(), [[1, 2, 10]]);

      graph.setEdge(1, 2, 11);

      assert.deepEqual(graph.edges(), [[1, 2, 11]]);
    });
  });

  describe('#deleteEdge', () => {
    it('removes the edge between the nodes', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);
      graph.setEdge(2, 3, 11);

      assert.deepEqual(graph.edges(), [
        [1, 2, 10],
        [2, 3, 11],
      ]);

      graph.deleteEdge(1, 2);

      assert.deepEqual(graph.edges(), [[2, 3, 11]]);
    });

    it('returns true iff an existing edge was removed', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);
      graph.setEdge(2, 3, 11);

      assert.equal(graph.deleteEdge(2, 1), false);

      assert.equal(graph.deleteEdge(1, 2), true);
      assert.equal(graph.deleteEdge(1, 2), false);
    });
  });

  describe('#getEdge', () => {
    it('returns the edge between two nodes', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);

      assert.equal(graph.getEdge(1, 2), 10);
    });

    it('returns undefined if there is no edge between the two nodes', () => {
      const graph = newGraph();

      assert.equal(graph.getEdge(1, 2), undefined);
    });
  });

  describe('#hasEdge', () => {
    it('returns true iff there is an edge between the two nodes', () => {
      const graph = newGraph();

      graph.setEdge(1, 2, 10);

      assert.equal(graph.hasEdge(1, 2), true);

      assert.equal(graph.hasEdge(1, 1), false);
      assert.equal(graph.hasEdge(2, 1), false);
      assert.equal(graph.hasEdge(2, 3), false);
    });
  });

  describe('#nodes', () => {
    it('returns the list of nodes in the graph', () => {
      const graph = newGraph();

      assert.deepEqual(graph.nodes(), []);

      graph.addNode(1);
      graph.addNode(2);

      assert.deepEqual(graph.nodes(), [1, 2]);

      graph.removeNode(2);
      graph.addNode(3);

      assert.deepEqual(graph.nodes(), [1, 3]);

      graph.removeNode(1);
      graph.removeNode(3);

      assert.deepEqual(graph.nodes(), []);
    });
  });

  describe('#edges', () => {
    it('returns the list of edges between any node in the graph', () => {
      const graph = newGraph();

      assert.deepEqual(graph.edges(), []);

      graph.setEdge(1, 2, 10);
      graph.setEdge(2, 3, 11);

      assert.deepEqual(graph.edges(), [
        [1, 2, 10],
        [2, 3, 11],
      ]);

      graph.deleteEdge(2, 3);
      graph.setEdge(3, 4, 12);

      assert.deepEqual(graph.edges(), [
        [1, 2, 10],
        [3, 4, 12],
      ]);

      graph.deleteEdge(1, 2);
      graph.deleteEdge(3, 4);

      assert.deepEqual(graph.edges(), []);
    });
  });

  describe('#adjacent', () => {
    it('returns the list of nodes and edges adjacent to the given node', () => {
      const graph = newGraph();

      graph.setEdge(1, 1, 10);
      graph.setEdge(1, 2, 11);
      graph.setEdge(1, 3, 12);
      graph.setEdge(2, 1, 13);
      graph.setEdge(2, 2, 14);
      graph.setEdge(2, 3, 15);
      graph.setEdge(3, 1, 16);
      graph.setEdge(3, 2, 17);
      graph.setEdge(3, 3, 18);

      assert.deepEqual(graph.adjacent(1), [
        [1, 10],
        [2, 11],
        [3, 12],
      ]);
      assert.deepEqual(graph.adjacent(2), [
        [1, 13],
        [2, 14],
        [3, 15],
      ]);
      assert.deepEqual(graph.adjacent(3), [
        [1, 16],
        [2, 17],
        [3, 18],
      ]);

      assert.deepEqual(graph.adjacent(0), []);
    });
  });

  describe('#optimalPaths', () => {
    const graphs = {
      empty: newGraph(),
      noEdges: newGraph({ nodes: [1, 2, 3] }),
      selfEdge: newGraph({ edges: [[1, 1, 1]] }),
      connected: newGraph({
        edges: [
          [1, 2, 10],
          [2, 3, 11],
          [3, 4, 12],
          [4, 5, 13],
          [5, 6, 14],
          [1, 5, 15],
        ],
      }),
      cycle: newGraph({
        edges: [
          [1, 2, 1],
          [2, 3, 1],
          [3, 4, 0], // 0-weight cycle 3 -> 4 -> 5 -> 3
          [4, 5, 0],
          [5, 3, 0],
          [5, 6, 1],
          [6, 7, 1],
        ],
      }),
    };

    const tests: Array<{
      name: string;
      graph: Graph<number, number>;
      source: number;
      targets: number[];
      want: Path<number, number, number>[];
      weightFunc?: (edge: number, from: number, to: number) => number;
      algebra?: PathAlgebra<number>;
    }> = [
      {
        name: 'empty targets',
        graph: graphs.connected,
        source: 1,
        targets: [],
        want: [],
      },
      {
        name: 'empty graph',
        graph: graphs.empty,
        source: 1,
        targets: [2],
        want: [{ source: 1, target: 2, totalWeight: null, path: null }],
      },
      {
        name: 'graph without edges',
        graph: graphs.noEdges,
        source: 1,
        targets: [2],
        want: [{ source: 1, target: 2, totalWeight: null, path: null }],
      },
      {
        name: 'target = source, missing node',
        graph: graphs.empty,
        source: 1,
        targets: [1],
        want: [{ source: 1, target: 1, totalWeight: null, path: null }],
      },
      {
        name: 'target = source, existing node',
        graph: graphs.noEdges,
        source: 1,
        targets: [1],
        want: [{ source: 1, target: 1, totalWeight: 0, path: [] }],
      },
      {
        name: 'target = source, self edge',
        graph: graphs.selfEdge,
        source: 1,
        targets: [1],
        want: [{ source: 1, target: 1, totalWeight: 0, path: [] }],
      },
      {
        name: 'target = source, zero-weight self edge',
        graph: graphs.selfEdge,
        source: 1,
        targets: [1],
        weightFunc: () => 0,
        want: [{ source: 1, target: 1, totalWeight: 0, path: [] }],
      },
      {
        name: 'connected graph',
        graph: graphs.connected,
        source: 1,
        targets: [2, 3, 4, 5, 6],
        want: [
          {
            source: 1,
            target: 2,
            totalWeight: 1,
            path: [{ from: 1, to: 2, edge: 10, weight: 1 }],
          },
          {
            source: 1,
            target: 3,
            totalWeight: 2,
            path: [
              { from: 1, to: 2, edge: 10, weight: 1 },
              { from: 2, to: 3, edge: 11, weight: 1 },
            ],
          },
          {
            source: 1,
            target: 4,
            totalWeight: 3,
            path: [
              { from: 1, to: 2, edge: 10, weight: 1 },
              { from: 2, to: 3, edge: 11, weight: 1 },
              { from: 3, to: 4, edge: 12, weight: 1 },
            ],
          },
          {
            source: 1,
            target: 5,
            totalWeight: 1,
            path: [{ from: 1, to: 5, edge: 15, weight: 1 }],
          },
          {
            source: 1,
            target: 6,
            totalWeight: 2,
            path: [
              { from: 1, to: 5, edge: 15, weight: 1 },
              { from: 5, to: 6, edge: 14, weight: 1 },
            ],
          },
        ],
      },
      {
        name: 'uneven weights',
        graph: graphs.connected,
        source: 1,
        targets: [6],
        want: [
          {
            source: 1,
            target: 6,
            totalWeight: 5,
            path: [
              { from: 1, to: 2, edge: 10, weight: 1 },
              { from: 2, to: 3, edge: 11, weight: 1 },
              { from: 3, to: 4, edge: 12, weight: 1 },
              { from: 4, to: 5, edge: 13, weight: 1 },
              { from: 5, to: 6, edge: 14, weight: 1 },
            ],
          },
        ],
        // make the 1 -> 6 "shortcut" cost more than the full path.
        weightFunc: (_, from, to) => (from === 1 && to === 5 ? 5 : 1),
      },
      {
        name: 'cycle',
        graph: graphs.cycle,
        source: 1,
        targets: [7],
        weightFunc: e => e,
        want: [
          {
            source: 1,
            target: 7,
            totalWeight: 4,
            path: [
              { from: 1, to: 2, edge: 1, weight: 1 },
              { from: 2, to: 3, edge: 1, weight: 1 },
              { from: 3, to: 4, edge: 0, weight: 0 },
              { from: 4, to: 5, edge: 0, weight: 0 },
              { from: 5, to: 6, edge: 1, weight: 1 },
              { from: 6, to: 7, edge: 1, weight: 1 },
            ],
          },
        ],
      },
      {
        name: 'bottleneck',
        graph: newUndirectedGraph({
          edges: [
            [1, 2, 5],
            [1, 3, 10],
            [1, 4, 30],
            [2, 3, 8],
            [2, 5, 25],
            [3, 4, 20],
            [3, 6, 35],
            [4, 6, 12],
            [5, 6, 40],
            [5, 7, 50],
            [6, 7, 22],
          ],
        }),
        source: 1,
        targets: [2],
        weightFunc: e => e,
        algebra: BottleneckPathAlgebra,
        want: [
          {
            source: 1,
            target: 2,
            totalWeight: 20,
            path: [
              { from: 1, to: 4, edge: 30, weight: 30 },
              { from: 4, to: 3, edge: 20, weight: 20 },
              { from: 3, to: 6, edge: 35, weight: 35 },
              { from: 6, to: 5, edge: 40, weight: 40 },
              { from: 5, to: 2, edge: 25, weight: 25 },
            ],
          },
        ],
      },
      {
        name: 'reliability',
        graph: newUndirectedGraph({
          edges: [
            // Direct path: 0.8
            [1, 2, 0.8],
            // 2-hop path: 0.81
            [1, 3, 0.9],
            [3, 2, 0.9],
            // 3-hop path: ~0.857
            [1, 4, 0.95],
            [4, 5, 0.95],
            [5, 2, 0.95],
          ],
        }),
        source: 1,
        targets: [2],
        weightFunc: e => e,
        algebra: ReliabilityPathAlgebra,
        want: [
          {
            source: 1,
            target: 2,
            totalWeight: 0.95 * 0.95 * 0.95,
            path: [
              { from: 1, to: 4, edge: 0.95, weight: 0.95 },
              { from: 4, to: 5, edge: 0.95, weight: 0.95 },
              { from: 5, to: 2, edge: 0.95, weight: 0.95 },
            ],
          },
        ],
      },
    ];

    for (const t of tests) {
      it(t.name, () => {
        const got = t.graph.optimalPaths(
          t.source,
          t.targets,
          t.weightFunc ?? (() => 1),
          t.algebra ?? ShortestPathAlgebra,
        );

        assert.deepEqual(got, t.want);
      });
    }
  });
});
