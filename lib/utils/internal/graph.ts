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
export type Path<Node, Edge> = {
  /** Source node of the path. */
  readonly source: Node;

  /** Target node of the path. */
  readonly target: Node;

  /** Total weight the path. Null if there is no path. */
  readonly totalWeight: number | null;

  /**
   * Full path from source to target node.
   * If there is no path between the two nodes, this will be null.
   * If source and target are the same node, this will be an empty array.
   */
  readonly path: ReadonlyArray<{
    readonly from: Node;
    readonly to: Node;
    readonly edge: Edge;
    readonly weight: number;
  }> | null;
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
   * Finds the shortest path from the source node to each of the target nodes,
   * according to the given weight function.
   *
   * @param source source node to find the shortest paths from.
   * @param targets target nodes to find the shortest paths to.
   * @param weightFunc function to compute the weight of an edge. It must not
   *   return negative numbers.
   * @returns An array containing a `Path` for each (source, target) pair.
   */
  shortestPaths(
    source: Node,
    targets: Node[],
    weightFunc: (edge: Edge, fromNode: Node, toNode: Node) => number,
  ): Path<Node, Edge>[] {
    if (targets.length === 0) {
      return [];
    }

    type Entry = {
      readonly nodeEntry: NodeEntry<Node, Edge, NodeKey>;
      readonly nodeKey: NodeKey;
      readonly totalWeight: number;
      readonly parent: {
        readonly entry: Entry;
        readonly edgeEntry: EdgeEntry<Node, Edge, NodeKey>;
        readonly edgeWeight: number;
      } | null;
    };

    // Note: our heap implementation is for a max-heap, so we use > as cmp to
    // obtain a min-heap for the priority queue.
    const cmp = (a: Entry, b: Entry) => a.totalWeight > b.totalWeight;
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
        totalWeight: 0,
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
        const newWeight = totalWeight + weight;

        const exploredEntry = explored.get(adjacentNodeKey);
        if (
          exploredEntry === undefined ||
          newWeight < exploredEntry.totalWeight
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

    const getPath = (target: Node): Path<Node, Edge> => {
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
