export type Doc =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'concat'; readonly parts: readonly Doc[] }
  | { readonly kind: 'indent'; readonly spaces: number; readonly contents: Doc }
  | {
      readonly kind: 'group';
      readonly contents: Doc;
      readonly shouldBreak: boolean;
    }
  | {
      readonly kind: 'line';
      readonly soft: boolean;
      readonly hard: boolean;
    }
  | {
      readonly kind: 'if-break';
      readonly breakContents: Doc;
      readonly flatContents: Doc;
    }
  | { readonly kind: 'line-suffix'; readonly value: string }
  | { readonly kind: 'break-parent' };

export const emptyDoc: Doc = { kind: 'text', value: '' };

/**
 * Creates a literal text `Doc` node.
 *
 * @param value Literal string without raw newline characters.
 * @returns A text `Doc` node.
 */
export function text(value: string): Doc {
  return { kind: 'text', value };
}

/**
 * Concatenates multiple `Doc` nodes in sequence.
 *
 * @param parts Ordered `Doc` nodes to concatenate.
 * @returns A combined `Doc` node.
 */
export function concat(parts: readonly Doc[]): Doc {
  if (parts.length === 0) {
    return emptyDoc;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return { kind: 'concat', parts };
}

/**
 * Increases indentation for line breaks rendered inside `contents`.
 *
 * @param spaces Number of spaces to add to the active indentation level.
 * @param contents Inner `Doc` subtree to indent.
 * @returns An indented `Doc` node.
 */
export function indent(spaces: number, contents: Doc): Doc {
  return { kind: 'indent', spaces, contents };
}

/**
 * Wraps `contents` in a width-aware Wadler-Lindig layout group.
 *
 * Renders flat on a single line when it fits within `printWidth`, or breaks
 * direct `line` and `softline` nodes when it overflows or `shouldBreak` is
 * `true`.
 *
 * @param contents Inner `Doc` subtree to group.
 * @param shouldBreak If `true`, forces the group to break unconditionally.
 * @returns A group `Doc` node.
 */
export function group(contents: Doc, shouldBreak = false): Doc {
  return { kind: 'group', contents, shouldBreak };
}

export const line: Doc = { kind: 'line', soft: false, hard: false };
export const softline: Doc = { kind: 'line', soft: true, hard: false };
export const hardline: Doc = { kind: 'line', soft: false, hard: true };

/**
 * Selects between two `Doc` nodes based on whether the enclosing group breaks.
 *
 * @param breakContents `Doc` rendered when the enclosing group breaks.
 * @param flatContents `Doc` rendered when the enclosing group stays flat.
 * @returns An `if-break` `Doc` node.
 */
export function ifBreak(breakContents: Doc, flatContents: Doc = emptyDoc): Doc {
  return { kind: 'if-break', breakContents, flatContents };
}

/**
 * Buffers `value` (such as an inline `;` comment) until the next newline.
 *
 * @param value Suffix text to append at the end of the current output line.
 * @returns A `line-suffix` `Doc` node.
 */
export function lineSuffix(value: string): Doc {
  return { kind: 'line-suffix', value };
}

export const breakParent: Doc = { kind: 'break-parent' };

/**
 * Joins `items` with `sep` placed between adjacent elements.
 *
 * @param sep Separator `Doc` inserted between elements.
 * @param items `Doc` elements to join.
 * @returns A concatenated `Doc` node.
 */
export function joinDocs(sep: Doc, items: readonly Doc[]): Doc {
  const out: Doc[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) {
      out.push(sep);
    }
    out.push(items[i]);
  }
  return concat(out);
}

const enum Mode {
  Flat = 0,
  Break = 1,
}

interface PrintCmd {
  readonly indent: number;
  readonly mode: Mode;
  readonly doc: Doc;
}

interface PropagateResult {
  readonly doc: Doc;
  readonly forceBreak: boolean;
  readonly pendingSuffix: boolean;
  readonly hasText: boolean;
}

function propagateBreaks(doc: Doc, incomingSuffix = false): PropagateResult {
  switch (doc.kind) {
    case 'text': {
      const nonEmpty = doc.value.length > 0;
      return {
        doc,
        forceBreak: nonEmpty && incomingSuffix,
        pendingSuffix: incomingSuffix,
        hasText: nonEmpty,
      };
    }
    case 'line-suffix':
      return {
        doc,
        forceBreak: false,
        pendingSuffix: true,
        hasText: false,
      };
    case 'break-parent':
      return {
        doc,
        forceBreak: true,
        pendingSuffix: incomingSuffix,
        hasText: false,
      };
    case 'line':
      return {
        doc,
        forceBreak: doc.hard,
        pendingSuffix: doc.hard ? false : incomingSuffix,
        hasText: false,
      };
    case 'indent': {
      const inner = propagateBreaks(doc.contents, incomingSuffix);
      return {
        doc: { kind: 'indent', spaces: doc.spaces, contents: inner.doc },
        forceBreak: inner.forceBreak,
        pendingSuffix: inner.pendingSuffix,
        hasText: inner.hasText,
      };
    }
    case 'if-break': {
      const b = propagateBreaks(doc.breakContents, false);
      const f = propagateBreaks(doc.flatContents, incomingSuffix);
      return {
        doc: {
          kind: 'if-break',
          breakContents: b.doc,
          flatContents: f.doc,
        },
        forceBreak: f.forceBreak,
        pendingSuffix: f.pendingSuffix,
        hasText: f.hasText || b.hasText,
      };
    }
    case 'concat': {
      let anyBreak = false;
      let anyText = false;
      let curSuffix = incomingSuffix;
      const parts: Doc[] = [];
      for (const part of doc.parts) {
        const res = propagateBreaks(part, curSuffix);
        parts.push(res.doc);
        if (res.forceBreak) {
          anyBreak = true;
        }
        if (res.hasText) {
          anyText = true;
        }
        curSuffix = res.pendingSuffix;
      }
      return {
        doc: { kind: 'concat', parts },
        forceBreak: anyBreak,
        pendingSuffix: curSuffix,
        hasText: anyText,
      };
    }
    case 'group': {
      const inner = propagateBreaks(doc.contents, false);
      const groupShouldBreak = doc.shouldBreak || inner.forceBreak;
      return {
        doc: {
          kind: 'group',
          contents: inner.doc,
          shouldBreak: groupShouldBreak,
        },
        forceBreak: incomingSuffix && inner.hasText,
        pendingSuffix:
          inner.pendingSuffix || (!inner.hasText && incomingSuffix),
        hasText: inner.hasText,
      };
    }
  }
}

function fits(remainingWidth: number, stack: readonly PrintCmd[]): boolean {
  let rem = remainingWidth;
  const work = [...stack];

  while (rem >= 0 && work.length > 0) {
    const cmd = work.pop()!;
    const { indent: ind, mode, doc } = cmd;

    switch (doc.kind) {
      case 'text':
        rem -= doc.value.length;
        break;
      case 'line-suffix':
      case 'break-parent':
        break;
      case 'concat':
        for (let i = doc.parts.length - 1; i >= 0; i--) {
          work.push({ indent: ind, mode, doc: doc.parts[i] });
        }
        break;
      case 'indent':
        work.push({ indent: ind + doc.spaces, mode, doc: doc.contents });
        break;
      case 'group':
        work.push({
          indent: ind,
          mode: doc.shouldBreak ? Mode.Break : mode,
          doc: doc.contents,
        });
        break;
      case 'if-break':
        work.push({
          indent: ind,
          mode,
          doc: mode === Mode.Break ? doc.breakContents : doc.flatContents,
        });
        break;
      case 'line':
        if (mode === Mode.Break || doc.hard) {
          return true;
        }
        if (!doc.soft) {
          rem -= 1;
        }
        break;
    }
  }

  return rem >= 0;
}

/**
 * Renders `rootDoc` to a string using Wadler-Lindig width-fitting.
 *
 * @param rootDoc Root `Doc` node to print.
 * @param printWidth Target maximum column width per line.
 * @param initialColumn Starting 0-based column offset. Defaults to `0`.
 * @returns The formatted string with trailing horizontal whitespace stripped
 *   before newlines.
 */
export function printDoc(
  rootDoc: Doc,
  printWidth: number,
  initialColumn = 0,
): string {
  const prepared = propagateBreaks(rootDoc).doc;
  const out: string[] = [];
  let col = initialColumn;
  const lineSuffixes: { readonly indent: number; readonly value: string }[] =
    [];

  const stack: PrintCmd[] = [{ indent: 0, mode: Mode.Break, doc: prepared }];

  const flushLineSuffixes = () => {
    if (lineSuffixes.length === 0) {
      return;
    }
    const items = lineSuffixes.splice(0, lineSuffixes.length);
    out.push(items[0].value);
    for (let i = 1; i < items.length; i++) {
      out.push('\n');
      out.push(' '.repeat(items[i].indent));
      out.push(items[i].value.trimStart());
    }
  };

  while (stack.length > 0) {
    const { indent: ind, mode, doc } = stack.pop()!;

    switch (doc.kind) {
      case 'text':
        if (doc.value.length > 0) {
          out.push(doc.value);
          col += doc.value.length;
        }
        break;
      case 'break-parent':
        break;
      case 'line-suffix':
        lineSuffixes.push({ indent: ind, value: doc.value });
        break;
      case 'concat':
        for (let i = doc.parts.length - 1; i >= 0; i--) {
          stack.push({ indent: ind, mode, doc: doc.parts[i] });
        }
        break;
      case 'indent':
        stack.push({ indent: ind + doc.spaces, mode, doc: doc.contents });
        break;
      case 'if-break':
        stack.push({
          indent: ind,
          mode,
          doc: mode === Mode.Break ? doc.breakContents : doc.flatContents,
        });
        break;
      case 'group': {
        if (doc.shouldBreak) {
          stack.push({ indent: ind, mode: Mode.Break, doc: doc.contents });
        } else {
          const probe: PrintCmd = {
            indent: ind,
            mode: Mode.Flat,
            doc: doc.contents,
          };
          const flatFits = fits(printWidth - col, [...stack, probe]);
          stack.push({
            indent: ind,
            mode: flatFits ? Mode.Flat : Mode.Break,
            doc: doc.contents,
          });
        }
        break;
      }
      case 'line': {
        if (mode === Mode.Break || doc.hard) {
          flushLineSuffixes();
          out.push('\n');
          if (ind > 0) {
            out.push(' '.repeat(ind));
          }
          col = ind;
        } else if (!doc.soft) {
          out.push(' ');
          col += 1;
        }
        break;
      }
    }
  }

  flushLineSuffixes();

  // Strip trailing spaces before newlines (e.g. empty indented blank lines).
  return out.join('').replace(/[ \t]+\n/g, '\n');
}
