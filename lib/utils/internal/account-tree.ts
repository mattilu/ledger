export type Node<T> = {
  readonly name: string;
  readonly data: T;
  readonly children: Node<T>[];
};

type TempNode<T> = {
  value?: T;
  readonly children: Map<string, TempNode<T>>;
};

/**
 * Transforms a flat account map into a tree structure.
 *
 * @param accountMap Map from full account name to its value.
 * @param getData Function to extract data to collect into the tree node.
 * @param reduce Function to compute node value, from its value and its
 *  children's.
 * @param filter Function to determine whether a node should be kept.
 * @returns The root node of the account tree.
 */
export function makeAccountTree<T, U>(
  accountMap: Map<string, T>,
  getData: (value: T) => U,
  reduce: (
    nodeValue: U | undefined,
    childValues: readonly U[],
    depth: number,
  ) => U,
  filter: (node: Node<U>, depth: number) => boolean = () => true,
): Node<U> {
  const root: TempNode<U> = {
    value: undefined,
    children: new Map(),
  };

  for (const [account, item] of accountMap.entries()) {
    const node = account.split(':').reduce((node, account) => {
      const child = node.children.get(account);
      if (child) {
        return child;
      }

      const newNode: TempNode<U> = {
        value: undefined,
        children: new Map(),
      };
      node.children.set(account, newNode);
      return newNode;
    }, root);

    const value = getData(item);
    if (node.value === undefined) {
      node.value = value;
    }
  }

  function process(name: string, node: TempNode<U>, depth: number): Node<U> {
    const children: Node<U>[] = [];
    for (const [childName, childNode] of node.children) {
      children.push(process(childName, childNode, depth + 1));
    }

    return {
      name,
      data: reduce(
        node.value,
        children.map(x => x.data),
        depth,
      ),
      children,
    };
  }

  function doFilter(node: Node<U>, depth: number): Node<U> {
    return {
      name: node.name,
      data: node.data,
      children: node.children
        .map(child => doFilter(child, depth + 1))
        .filter(child => filter(child, depth + 1)),
    };
  }

  return doFilter(process('', root, 0), 0);
}

function maxWidth<T>(node: Node<T>, depth = 0): number {
  return Math.max(
    3,
    node.name.length + depth * 3,
    ...node.children.map(node => maxWidth(node, depth + 1)),
  );
}

/**
 * Formats a tree.
 *
 * @param root The root node of the tree to format.
 * @param format Function to format the value of an individual node.
 * @returns A string with the formatted node.
 */
export function formatTree<T>(
  root: Node<T>,
  format: (node: Node<T>, depth: number) => string[],
): string {
  const lines: string[] = [];
  const padding = maxWidth(root) + 2;

  function run(
    node: Node<T>,
    prefix: string,
    nodePrefix: string,
    childNodePrefix: string,
    depth: number,
  ) {
    for (const [isFirst, isLast, str] of enumerate(
      ifEmpty(format(node, depth), ['']),
    )) {
      let pfx: string;
      if (isFirst) {
        pfx = `${prefix}${nodePrefix}${node.name}`;
      } else if (isLast && node.children.length === 0) {
        pfx = `${prefix}${childNodePrefix}└   `;
      } else {
        pfx = `${prefix}${childNodePrefix}│   `;
      }
      lines.push(`${pfx.padEnd(padding, ' ')}${str}`.trimEnd());
    }

    const nextPrefix = `${prefix}${childNodePrefix}`;
    for (const [index, childNode] of node.children.entries()) {
      const isLastChild = index === node.children.length - 1;
      const nextNodePrefix = isLastChild ? '└─ ' : '├─ ';
      const nextChildNodePrefix = isLastChild ? '   ' : '│  ';
      run(
        childNode,
        nextPrefix,
        nextNodePrefix,
        nextChildNodePrefix,
        depth + 1,
      );
    }
  }

  run(root, '', '╿', '', 0);

  return lines.join('\n');
}

function ifEmpty<T>(array: readonly T[], defaultValue: readonly T[]) {
  return array.length === 0 ? defaultValue : array;
}

function enumerate<T>(entries: readonly T[]): [boolean, boolean, T][] {
  return entries.map((v, i) => [i === 0, i === entries.length - 1, v]);
}
