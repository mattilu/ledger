export type Doc =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'concat'; readonly parts: readonly Doc[] }
  | { readonly kind: 'fill'; readonly parts: readonly Doc[] }
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
 * Packs alternating `[content, sep, content, ...]` nodes onto as few lines as
 * fit within `printWidth`, breaking only when the next item overflows or a
 * comment/hardline forces a break.
 *
 * @param parts Alternating content and separator `Doc` nodes.
 * @returns A `fill` `Doc` node.
 */
export function fill(parts: readonly Doc[]): Doc {
  if (parts.length === 0) {
    return emptyDoc;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return { kind: 'fill', parts };
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
  readonly fillIndex?: number;
}

interface PropagateResult {
  readonly doc: Doc;
  readonly forceBreak: boolean;
}

const MAX_EFFECTIVE_INDENT = 4096;

function propagateBreaks(doc: Doc): PropagateResult {
  switch (doc.kind) {
    case 'text':
      return { doc, forceBreak: false };
    case 'line-suffix':
    case 'break-parent':
      return { doc, forceBreak: true };
    case 'line':
      return { doc, forceBreak: doc.hard };
    case 'indent': {
      const inner = propagateBreaks(doc.contents);
      return {
        doc: { kind: 'indent', spaces: doc.spaces, contents: inner.doc },
        forceBreak: inner.forceBreak,
      };
    }
    case 'if-break': {
      const b = propagateBreaks(doc.breakContents);
      const f = propagateBreaks(doc.flatContents);
      return {
        doc: { kind: 'if-break', breakContents: b.doc, flatContents: f.doc },
        forceBreak: f.forceBreak,
      };
    }
    case 'concat':
    case 'fill': {
      const accParts: Doc[] = [];
      let anyBreak = false;
      for (const part of doc.parts) {
        const res = propagateBreaks(part);
        accParts.push(res.doc);
        if (res.forceBreak) {
          anyBreak = true;
        }
      }
      return {
        doc: { kind: doc.kind, parts: accParts },
        forceBreak: anyBreak,
      };
    }
    case 'group': {
      const inner = propagateBreaks(doc.contents);
      const shouldBreak = doc.shouldBreak || inner.forceBreak;
      return {
        doc: { kind: 'group', contents: inner.doc, shouldBreak },
        forceBreak: shouldBreak,
      };
    }
  }
}

function fits(
  remainingWidth: number,
  mainStack: readonly PrintCmd[],
  firstCmd: PrintCmd,
): boolean {
  let rem = remainingWidth;
  let mainIdx = mainStack.length - 1;
  const local: PrintCmd[] = [firstCmd];

  while (rem >= 0) {
    let cmd: PrintCmd;
    if (local.length > 0) {
      cmd = local.pop()!;
    } else if (mainIdx >= 0) {
      cmd = mainStack[mainIdx--];
    } else {
      break;
    }

    const { indent: ind, mode, doc } = cmd;

    switch (doc.kind) {
      case 'text':
        rem -= doc.value.length;
        break;
      case 'line-suffix':
      case 'break-parent':
        break;
      case 'concat':
      case 'fill': {
        const start = cmd.fillIndex ?? 0;
        for (let i = doc.parts.length - 1; i >= start; i--) {
          local.push({ indent: ind, mode, doc: doc.parts[i] });
        }
        break;
      }
      case 'indent':
        local.push({
          indent: Math.min(ind + doc.spaces, MAX_EFFECTIVE_INDENT),
          mode,
          doc: doc.contents,
        });
        break;
      case 'group':
        local.push({
          indent: ind,
          mode: doc.shouldBreak ? Mode.Break : mode,
          doc: doc.contents,
        });
        break;
      case 'if-break':
        local.push({
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

function measureFillFlat(
  remainingWidth: number,
  doc: Doc,
  initialIndent: number,
  allowTrailingLineSuffix: boolean,
): number {
  let rem = remainingWidth;
  let seenSuffix = false;
  const local: PrintCmd[] = [{ indent: initialIndent, mode: Mode.Flat, doc }];

  while (rem >= 0 && local.length > 0) {
    const { indent: ind, mode, doc: cur } = local.pop()!;

    switch (cur.kind) {
      case 'text':
        if (cur.value.length > 0) {
          if (seenSuffix) {
            return -1;
          }
          rem -= cur.value.length;
        }
        break;
      case 'line-suffix':
        if (!allowTrailingLineSuffix) {
          return -1;
        }
        seenSuffix = true;
        break;
      case 'break-parent':
        return -1;
      case 'concat':
      case 'fill':
        for (let i = cur.parts.length - 1; i >= 0; i--) {
          local.push({ indent: ind, mode, doc: cur.parts[i] });
        }
        break;
      case 'indent':
        local.push({
          indent: Math.min(ind + cur.spaces, MAX_EFFECTIVE_INDENT),
          mode,
          doc: cur.contents,
        });
        break;
      case 'group':
        if (cur.shouldBreak) {
          return -1;
        }
        local.push({ indent: ind, mode, doc: cur.contents });
        break;
      case 'if-break':
        local.push({ indent: ind, mode, doc: cur.flatContents });
        break;
      case 'line':
        if (cur.hard) {
          return -1;
        }
        if (!cur.soft) {
          rem -= 1;
        }
        break;
    }
  }

  return rem;
}

function stripTrailingHorizontalWhitespace(text: string): string {
  const parts: string[] = [];
  let start = 0;
  let idx = text.indexOf('\n');
  while (idx !== -1) {
    let lineEnd = idx;
    while (lineEnd > start) {
      const ch = text.charCodeAt(lineEnd - 1);
      if (ch === 32 || ch === 9) {
        lineEnd--;
      } else {
        break;
      }
    }
    if (lineEnd < idx) {
      parts.push(text.slice(start, lineEnd));
      start = idx;
    }
    idx = text.indexOf('\n', idx + 1);
  }
  let finalEnd = text.length;
  while (finalEnd > start) {
    const ch = text.charCodeAt(finalEnd - 1);
    if (ch === 32 || ch === 9) {
      finalEnd--;
    } else {
      break;
    }
  }
  if (parts.length === 0 && finalEnd === text.length) {
    return text;
  }
  parts.push(text.slice(start, finalEnd));
  return parts.join('');
}

/**
 * Renders `rootDoc` to a string using Wadler-Lindig width-fitting.
 *
 * @param rootDoc Root `Doc` node to print.
 * @param printWidth Target maximum column width per line.
 * @param initialColumn Starting 0-based column offset. Defaults to `0`.
 * @returns The formatted string with trailing horizontal whitespace stripped
 *   before newlines and at EOF.
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

  const trimTrailingSpacesBeforeSuffix = () => {
    let hasNonSpaceOnLine = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const part = out[i];
      const nl = part.lastIndexOf('\n');
      const slice = nl === -1 ? part : part.slice(nl + 1);
      for (let j = slice.length - 1; j >= 0; j--) {
        const ch = slice.charCodeAt(j);
        if (ch !== 32 && ch !== 9) {
          hasNonSpaceOnLine = true;
          break;
        }
      }
      if (hasNonSpaceOnLine || nl !== -1) {
        break;
      }
    }
    if (!hasNonSpaceOnLine) {
      return;
    }
    while (out.length > 0) {
      const last = out[out.length - 1];
      let end = last.length;
      while (end > 0) {
        const ch = last.charCodeAt(end - 1);
        if (ch === 32 || ch === 9) {
          end--;
        } else {
          break;
        }
      }
      if (end === last.length) {
        break;
      }
      if (end === 0) {
        out.pop();
      } else {
        out[out.length - 1] = last.slice(0, end);
        break;
      }
    }
  };

  const flushLineSuffixes = () => {
    if (lineSuffixes.length === 0) {
      return;
    }
    trimTrailingSpacesBeforeSuffix();
    const items = lineSuffixes.splice(0, lineSuffixes.length);
    out.push(items[0].value);
    for (let i = 1; i < items.length; i++) {
      out.push('\n');
      out.push(' '.repeat(items[i].indent));
      out.push(items[i].value.trimStart());
    }
  };

  while (stack.length > 0) {
    const { indent: ind, mode, doc, fillIndex } = stack.pop()!;

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
      case 'fill': {
        const idx = fillIndex ?? 0;
        if (idx >= doc.parts.length) {
          break;
        }
        if (mode === Mode.Flat) {
          for (let i = doc.parts.length - 1; i >= idx; i--) {
            stack.push({ indent: ind, mode: Mode.Flat, doc: doc.parts[i] });
          }
          break;
        }
        const content = doc.parts[idx];
        if (idx + 1 >= doc.parts.length) {
          const contentFits = fits(printWidth - col, stack, {
            indent: ind,
            mode: Mode.Flat,
            doc: content,
          });
          stack.push({
            indent: ind,
            mode: contentFits ? Mode.Flat : Mode.Break,
            doc: content,
          });
          break;
        }
        const ws = doc.parts[idx + 1];
        if (idx + 2 >= doc.parts.length) {
          const rem1 = measureFillFlat(printWidth - col, content, ind, false);
          const rem2 = rem1 >= 0 ? measureFillFlat(rem1, ws, ind, false) : -1;
          const tailFits =
            rem2 >= 0 &&
            fits(rem2, stack, {
              indent: ind,
              mode: Mode.Flat,
              doc: emptyDoc,
            });
          if (tailFits) {
            stack.push({ indent: ind, mode: Mode.Flat, doc: ws });
            stack.push({ indent: ind, mode: Mode.Flat, doc: content });
          } else {
            const contentFits = fits(printWidth - col, [], {
              indent: ind,
              mode: Mode.Flat,
              doc: content,
            });
            stack.push({ indent: ind, mode: Mode.Break, doc: ws });
            stack.push({
              indent: ind,
              mode: contentFits ? Mode.Flat : Mode.Break,
              doc: content,
            });
          }
          break;
        }
        const nextContent = doc.parts[idx + 2];
        const rem1 = measureFillFlat(printWidth - col, content, ind, false);
        const rem2 = rem1 >= 0 ? measureFillFlat(rem1, ws, ind, false) : -1;
        const rem3 =
          rem2 >= 0 ? measureFillFlat(rem2, nextContent, ind, true) : -1;
        const isNextLast = idx + 3 >= doc.parts.length;
        const nextFits =
          rem3 >= 0 &&
          (!isNextLast ||
            fits(rem3, stack, {
              indent: ind,
              mode: Mode.Flat,
              doc: emptyDoc,
            }));
        if (nextFits) {
          stack.push({
            indent: ind,
            mode: Mode.Break,
            doc,
            fillIndex: idx + 2,
          });
          stack.push({ indent: ind, mode: Mode.Flat, doc: ws });
          stack.push({ indent: ind, mode: Mode.Flat, doc: content });
        } else {
          const contentFits = fits(printWidth - col, [], {
            indent: ind,
            mode: Mode.Flat,
            doc: content,
          });
          stack.push({
            indent: ind,
            mode: Mode.Break,
            doc,
            fillIndex: idx + 2,
          });
          stack.push({ indent: ind, mode: Mode.Break, doc: ws });
          stack.push({
            indent: ind,
            mode: contentFits ? Mode.Flat : Mode.Break,
            doc: content,
          });
        }
        break;
      }
      case 'indent':
        stack.push({
          indent: Math.min(ind + doc.spaces, MAX_EFFECTIVE_INDENT),
          mode,
          doc: doc.contents,
        });
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
        } else if (mode === Mode.Flat) {
          stack.push({ indent: ind, mode: Mode.Flat, doc: doc.contents });
        } else {
          const probe: PrintCmd = {
            indent: ind,
            mode: Mode.Flat,
            doc: doc.contents,
          };
          const flatFits = fits(printWidth - col, stack, probe);
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

  // Strip trailing spaces before newlines and at EOF (e.g. empty indented lines).
  return stripTrailingHorizontalWhitespace(out.join(''));
}
