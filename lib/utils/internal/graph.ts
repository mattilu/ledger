import { popHeap, pushHeap } from '../heap.js';

type NodeEntry<Node, Edge, NodeKey = Node> = {
  readonly node: Node;
  readonly adjacent: Map<NodeKey, EdgeEntry<Node, Edge, NodeKey>>;
};

type EdgeEntry<Node, Edge, NodeKey = Node> = {
  readonly edge: Edge;
  readonly toNodeEntry: NodeEntry<Node, Edge, NodeKey>;
};

/**
 * The result of a graph search for a (source, target) node pair.
 */
export type Path<Node, Edge, W> = {
  /** Source node of the path. */
  readonly source: Node;

  /** Target node of the path. */
  readonly target: Node;

  /** Total weight the path. Null if there is no path. */
  readonly totalWeight: W | null;

  /**
   * Full path from source to target node.
   * If there is no path between the two nodes, this will be null.
   * If source and target are the same node, this will be an empty array.
   */
  readonly path: ReadonlyArray<{
    readonly from: Node;
    readonly to: Node;
    readonly edge: Edge;
    readonly weight: W;
  }> | null;
};

export interface PathAlgebra<W> {
  /** The identity element `e` of the monoid. */
  readonly e: W;

  /** The associative binary operation ⊗
   *
   * Must satisfy the following properties:
   *
   * - Associativity: `(a ⊗ b) ⊗ c` = `a ⊗ (b ⊗ c)`.
   * - Identity element: `a ⊗ e` = `e ⊗ a` = `a`.
   */
  combine(a: W, b: W): W;

  /** The ordering function.
   *
   * Must define a strict total ordering, i.e. it must satisfy the following
   * properties:
   *
   * - Irreflexivity: `betterThan(a, a)` must always be `false`;
   * - Asymmetry: if `betterThan(a, b)` is `true`, then `betterThan(b, a)` must
   *   be `false`;
   * - Transitivity: if `betterThan(a, b)` and `betterThan(b, c)` are `true`,
   *   then `betterThan(a, c)` must also be `true`.
   * - Comparability: if `a` and `b` are not equivalent, then either
   *  `betterThan(a, b)` or `betterThan(b, a)` must be `true`.
   *
   * Additionally, it must satisfy the Isotonicity properties:
   *
   *  - Right isotonicity: if `betterThan(a, b)` is `true` then
   *   `betterThan(a ⊗ c, b ⊗ c)` must also be `true`.
   *  - Left isotonicity: if `betterThan(a, b)` is `true` then
   *   `betterThan(c ⊗ a, c ⊗ b)` must also be `true`.
   */
  betterThan(a: W, b: W): boolean;
}

/**
 * A PathAlgebra to compute the shortest path.
 */
export const ShortestPathAlgebra: PathAlgebra<number> = {
  e: 0,
  combine: (a, b) => a + b,
  betterThan: (a, b) => a < b,
};

/**
 * A PathAlgebra to compute the the widest bottleneck path.
 */
export const BottleneckPathAlgebra: PathAlgebra<number> = {
  e: Infinity,
  combine: (a, b) => Math.min(a, b),
  betterThan: (a, b) => a > b,
};

/**
 * A PathAlgebra to compute the most reliable path. Edge weights are expected to
 * be probabilities.
 */
export const ReliabilityPathAlgebra: PathAlgebra<number> = {
  e: 1,
  combine: (a, b) => a * b,
  betterThan: (a, b) => a > b,
};

/**
 * A directed graph, with nodes and edges of the given type.
 */
export class Graph<Node, Edge, NodeKey = Node> {
  private readonly nodeEntries: Map<NodeKey, NodeEntry<Node, Edge, NodeKey>> =
    new Map();

  /**
   * Constructs a new Graph.
   *
   * @param nodeKey Function to get the key of a node. Must return a value which
   *   can be used as a key in a `Map`.
   */
  constructor(private readonly nodeKey: (node: Node) => NodeKey) {}

  /**
   * Adds a new node to the graph. If a node with the same key already exists,
   * no change is made.
   *
   * @param node The node to add.
   * @returns True if the node was added, false if it already existed.
   */
  addNode(node: Node): boolean {
    const [added] = this.addNodeInternal(node);
    return added;
  }

  private addNodeInternal(
    node: Node,
  ): [boolean, NodeEntry<Node, Edge, NodeKey>] {
    const nodeKey = this.nodeKey(node);
    const entry = this.nodeEntries.get(nodeKey);
    if (entry !== undefined) {
      return [false, entry];
    }

    const newEntry: NodeEntry<Node, Edge, NodeKey> = {
      node,
      adjacent: new Map(),
    };
    this.nodeEntries.set(nodeKey, newEntry);
    return [true, newEntry];
  }

  /**
   * Removes an existing node from the graph.
   *
   * @param node Node to remove from the graph.
   * @returns True if the node was removed, false if it didn't exist.
   */
  removeNode(node: Node): boolean {
    const nodeKey = this.nodeKey(node);
    if (this.nodeEntries.delete(nodeKey)) {
      for (const entry of this.nodeEntries.values()) {
        entry.adjacent.delete(nodeKey);
      }
      return true;
    }
    return false;
  }

  /**
   * Adds an edge between two nodes of the graph.
   * Also adds the nodes if they don't already exist.
   * If the edge already exists, it gets replaced.
   *
   * @param from source node of the edge.
   * @param to destination node of the edge.
   * @param edge edge to set.
   */
  setEdge(from: Node, to: Node, edge: Edge): void {
    const [, fromEntry] = this.addNodeInternal(from);
    const [, toEntry] = this.addNodeInternal(to);
    fromEntry.adjacent.set(this.nodeKey(to), {
      edge,
      toNodeEntry: toEntry,
    });
  }

  /**
   * Deletes an edge between two nodes of the graph.
   *
   * @param from source node of the edge.
   * @param to destination node of the edge.
   * @returns true if the edge was removed, false if it didn't exist.
   */
  deleteEdge(from: Node, to: Node): boolean {
    const entry = this.nodeEntries.get(this.nodeKey(from));
    if (entry !== undefined) {
      return entry.adjacent.delete(this.nodeKey(to));
    }
    return false;
  }

  /**
   * Gets the edge between the two nodes.
   *
   * @param from source node of the edge.
   * @param to destination node of the edge.
   * @returns the edge, or undefined if it doesn't exist.
   */
  getEdge(from: Node, to: Node): Edge | undefined {
    return this.nodeEntry(from)?.adjacent.get(this.nodeKey(to))?.edge;
  }

  /**
   * Checks whether there is an edge between the two nodes.
   *
   * @param from source node of the edge.
   * @param to destination node of the edge.
   * @returns true if there is an edge between the nodes, otherwise false.
   */
  hasEdge(from: Node, to: Node): boolean {
    return this.nodeEntry(from)?.adjacent.has(this.nodeKey(to)) ?? false;
  }

  /**
   * Gets all the nodes in the graph.
   */
  nodes(): Node[] {
    return [...this.nodeEntries.values()].map(e => e.node);
  }

  /**
   * Gets all the edges in the graph.
   */
  edges(): Array<[from: Node, to: Node, edge: Edge]> {
    return [...this.nodeEntries.values()].flatMap(entry =>
      [...entry.adjacent.entries()].map(
        ([adjacentNodeKey, edge]): [Node, Node, Edge] => [
          entry.node,
          this.nodeEntries.get(adjacentNodeKey)!.node,
          edge.edge,
        ],
      ),
    );
  }

  // Gets the list of nodes which are adjacent to the given node.
  //
  // Returns an array of [node, edge] pairs of adjacent nodes, through the
  // corresponding edge.
  adjacent(node: Node): Array<[Node, Edge]> {
    const nodeEntry = this.nodeEntries.get(this.nodeKey(node));
    if (nodeEntry === undefined) {
      return [];
    }
    return [...nodeEntry.adjacent.entries()].map(([nodeKey, edge]) => [
      this.nodeEntries.get(nodeKey)!.node,
      edge.edge,
    ]);
  }

  /**
   * Finds the optimal path from the source node to each target node using a
   * generalized Dijkstra's algorithm over a Weight Monoid.
   *
   * @param source the starting node for the search.
   * @param targets array of nodes to find optimal paths to.
   * @param weightFunc function that returns the weight (W) of an edge.
   * @param algebra an object defining the algebraic structure of the weights.
   *
   * In addition to the `PathAlgebra` requirements, the following properties
   * must also be satisfied:
   *
   * - Monotonicity: `betterThan(a ⊗ b, a)` must always be false (no path can
   *   be better than its prefix).
   *
   * @returns An array containing a `Path` for each (source, target) pair, with
   * indices corresponding to the input `targets`.
   */
  optimalPaths<W>(
    source: Node,
    targets: Node[],
    weightFunc: (edge: Edge, fromNode: Node, toNode: Node) => W,
    algebra: PathAlgebra<W>,
  ): Path<Node, Edge, W>[] {
    if (targets.length === 0) {
      return [];
    }

    type Entry = {
      readonly nodeEntry: NodeEntry<Node, Edge, NodeKey>;
      readonly nodeKey: NodeKey;
      readonly totalWeight: W;
      readonly parent: {
        readonly entry: Entry;
        readonly edgeEntry: EdgeEntry<Node, Edge, NodeKey>;
        readonly edgeWeight: W;
      } | null;
    };

    // Note: our heap implementation is for a max-heap, so we negate betterThan
    // to keep the better value at the top of the heap.
    const cmp = (a: Entry, b: Entry) =>
      !algebra.betterThan(a.totalWeight, b.totalWeight);
    const queue: Entry[] = [];

    const visited = new Set<NodeKey>();
    const explored = new Map<NodeKey, Entry>();
    const targetsRemaining = new Set(targets.map(node => this.nodeKey(node)));

    const sourceNodeKey = this.nodeKey(source);
    const sourceNodeEntry = this.nodeEntries.get(sourceNodeKey);
    if (sourceNodeEntry !== undefined) {
      queue.push({
        nodeKey: sourceNodeKey,
        nodeEntry: sourceNodeEntry,
        totalWeight: algebra.e,
        parent: null,
      });
      explored.set(sourceNodeKey, queue[0]);
    }

    while (queue.length > 0) {
      popHeap(queue, cmp);
      const entry = queue.pop()!;
      const { nodeEntry, nodeKey, totalWeight } = entry;

      if (visited.has(nodeKey)) {
        continue;
      }
      visited.add(nodeKey);

      // Short circuit if we found all the target nodes.
      if (targetsRemaining.delete(nodeKey) && targetsRemaining.size === 0) {
        break;
      }

      for (const [adjacentNodeKey, edgeEntry] of nodeEntry.adjacent) {
        const weight = weightFunc(
          edgeEntry.edge,
          nodeEntry.node,
          edgeEntry.toNodeEntry.node,
        );
        const newWeight = algebra.combine(totalWeight, weight);

        const exploredEntry = explored.get(adjacentNodeKey);
        if (
          exploredEntry === undefined ||
          algebra.betterThan(newWeight, exploredEntry.totalWeight)
        ) {
          const adjacentEntry: Entry = {
            nodeKey: adjacentNodeKey,
            nodeEntry: edgeEntry.toNodeEntry,
            parent: { entry, edgeEntry, edgeWeight: weight },
            totalWeight: newWeight,
          };
          explored.set(adjacentNodeKey, adjacentEntry);
          pushHeap(queue, adjacentEntry, cmp);
        }
      }
    }

    const getPath = (target: Node): Path<Node, Edge, W> => {
      const targetEntry = explored.get(this.nodeKey(target));
      if (targetEntry === undefined) {
        return { source, target: target, totalWeight: null, path: null };
      }

      let entry: Entry | null = targetEntry;
      const path = [];
      while (entry.parent) {
        path.push({
          from: entry.parent.entry.nodeEntry.node,
          to: entry.nodeEntry.node,
          edge: entry.parent.edgeEntry.edge,
          weight: entry.parent.edgeWeight,
        });
        entry = entry.parent.entry;
      }

      return {
        source,
        target,
        totalWeight: targetEntry.totalWeight,
        path: path.reverse(),
      };
    };

    return targets.map(getPath);
  }

  private nodeEntry(node: Node): NodeEntry<Node, Edge, NodeKey> | undefined {
    return this.nodeEntries.get(this.nodeKey(node));
  }
}
