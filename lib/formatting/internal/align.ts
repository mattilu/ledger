import { FormatOptions } from '../options.js';

export interface AmountRowItem {
  readonly kind: 'amount-row';
  readonly leadingLines: readonly string[];
  readonly left: string;
  readonly intPart: string;
  readonly fracPart: string;
  readonly currency: string;
  readonly suffix: string;
  readonly trailingComment: string | null;
  readonly metadataBlock: string;
}

export interface PlainRowItem {
  readonly kind: 'plain-row';
  readonly leadingLines: readonly string[];
  readonly code: string;
  readonly trailingComment: string | null;
  readonly metadataBlock: string;
}

export interface MultilineRowItem {
  readonly kind: 'multiline-row';
  readonly leadingLines: readonly string[];
  readonly rendered: string;
  readonly metadataBlock: string;
}

export type DirectiveBodyItem = AmountRowItem | PlainRowItem | MultilineRowItem;

export interface AlignableDirectiveBlock {
  readonly kind: 'aligned-directive';
  readonly prefixText: string;
  readonly headerAndMetaLines: readonly string[];
  readonly items: readonly DirectiveBodyItem[];
  readonly isMultiline: boolean;
}

export interface StaticChunk {
  readonly kind: 'static-chunk';
  readonly text: string;
  readonly isMultiline: boolean;
}

export interface RawPragmaChunk {
  readonly kind: 'raw-pragma-chunk';
  readonly prefixText: string;
  readonly rawSlice: string;
  readonly isMultiline: boolean;
}

export type TopLevelFormattedSegment =
  AlignableDirectiveBlock | StaticChunk | RawPragmaChunk;

interface AlignmentMetrics {
  readonly anchor: number;
  readonly fracWidth: number;
}

function rowMetrics(
  row: AmountRowItem,
  options: FormatOptions,
): AlignmentMetrics {
  if (options.alignMode === 'currency') {
    const wholeLen = row.intPart.length + row.fracPart.length;
    return {
      anchor: row.left.length + options.minGapSpaces + wholeLen,
      fracWidth: 0,
    };
  }
  return {
    anchor: row.left.length + options.minGapSpaces + row.intPart.length,
    fracWidth:
      options.alignMode === 'decimal-and-currency' ? row.fracPart.length : 0,
  };
}

function computeBlockMetrics(
  items: readonly DirectiveBodyItem[],
  options: FormatOptions,
  maxAnchorCap: number | null,
): AlignmentMetrics {
  let anchor = 0;
  let fracWidth = 0;

  for (const item of items) {
    if (item.kind !== 'amount-row') {
      continue;
    }
    const m = rowMetrics(item, options);
    if (maxAnchorCap !== null && m.anchor > maxAnchorCap) {
      continue;
    }
    if (m.anchor > anchor) {
      anchor = m.anchor;
    }
    if (m.fracWidth > fracWidth) {
      fracWidth = m.fracWidth;
    }
  }

  return { anchor, fracWidth };
}

function formatAmountRowCode(
  row: AmountRowItem,
  metrics: AlignmentMetrics,
  options: FormatOptions,
): string {
  const { anchor: targetAnchor, fracWidth: targetFracWidth } = metrics;
  let core: string;

  if (options.alignScope === 'none') {
    const gap = ' '.repeat(options.minGapSpaces);
    core = `${row.left}${gap}${row.intPart}${row.fracPart} ${row.currency}`;
  } else if (options.alignMode === 'currency') {
    const whole = `${row.intPart}${row.fracPart}`;
    const gapLen = Math.max(
      options.minGapSpaces,
      targetAnchor - row.left.length - whole.length,
    );
    core = `${row.left}${' '.repeat(gapLen)}${whole} ${row.currency}`;
  } else if (options.alignMode === 'decimal') {
    const gapLen = Math.max(
      options.minGapSpaces,
      targetAnchor - row.left.length - row.intPart.length,
    );
    core = `${row.left}${' '.repeat(gapLen)}${row.intPart}${row.fracPart} ${row.currency}`;
  } else {
    const gapLen = Math.max(
      options.minGapSpaces,
      targetAnchor - row.left.length - row.intPart.length,
    );
    const afterFracCol =
      row.left.length + gapLen + row.intPart.length + row.fracPart.length;
    const currencyTarget = targetAnchor + targetFracWidth;
    const fracPadLen = Math.max(0, currencyTarget - afterFracCol);
    core = `${row.left}${' '.repeat(gapLen)}${row.intPart}${row.fracPart}${' '.repeat(fracPadLen)} ${row.currency}`;
  }

  return row.suffix.length > 0 ? `${core} ${row.suffix}` : core;
}

function renderDirectiveBlock(
  block: AlignableDirectiveBlock,
  metrics: AlignmentMetrics,
  options: FormatOptions,
): string {
  const preparedRows = block.items.map(item => {
    if (item.kind === 'amount-row') {
      return {
        kind: 'single' as const,
        leadingLines: item.leadingLines,
        code: formatAmountRowCode(item, metrics, options),
        trailingComment: item.trailingComment,
        metadataBlock: item.metadataBlock,
      };
    }
    if (item.kind === 'plain-row') {
      return {
        kind: 'single' as const,
        leadingLines: item.leadingLines,
        code: item.code,
        trailingComment: item.trailingComment,
        metadataBlock: item.metadataBlock,
      };
    }
    return {
      kind: 'multi' as const,
      leadingLines: item.leadingLines,
      rendered: item.rendered,
      metadataBlock: item.metadataBlock,
    };
  });

  let maxCodeWidth = 0;
  if (options.alignTrailingComments) {
    for (const r of preparedRows) {
      if (r.kind === 'single' && r.code.length > maxCodeWidth) {
        maxCodeWidth = r.code.length;
      }
    }
  }

  const lines: string[] = [...block.headerAndMetaLines];
  for (const r of preparedRows) {
    lines.push(...r.leadingLines);
    if (r.kind === 'single') {
      if (r.trailingComment !== null) {
        const pad = options.alignTrailingComments
          ? Math.max(2, maxCodeWidth - r.code.length + 2)
          : 2;
        lines.push(`${r.code}${' '.repeat(pad)}${r.trailingComment}`);
      } else {
        lines.push(r.code);
      }
    } else {
      lines.push(r.rendered);
    }
    if (r.metadataBlock.length > 0) {
      lines.push(r.metadataBlock);
    }
  }

  return `${block.prefixText}${lines.join('\n')}`;
}

/**
 * Renders top-level formatted segments with vertical amount/comment alignment.
 *
 * Applies `options.alignScope` and `options.alignMode` across transaction
 * postings and `balance` entries while leaving static and pragma chunks intact.
 *
 * @param segments Ordered top-level segments produced by `FormatterBuilder`.
 * @param options Resolved formatting options.
 * @returns The concatenated formatted document body (without trailing newline).
 */
export function renderSegments(
  segments: readonly TopLevelFormattedSegment[],
  options: FormatOptions,
): string {
  const maxAnchorCap =
    options.maxAlignColumn !== null
      ? Math.max(0, options.maxAlignColumn - 1)
      : null;

  let fileMetrics: AlignmentMetrics = { anchor: 0, fracWidth: 0 };
  if (options.alignScope === 'file') {
    let globalAnchor = options.alignColumn > 0 ? options.alignColumn - 1 : 0;
    let globalFrac = 0;
    for (const seg of segments) {
      if (seg.kind !== 'aligned-directive') {
        continue;
      }
      const m = computeBlockMetrics(seg.items, options, maxAnchorCap);
      if (m.anchor > globalAnchor) {
        globalAnchor = m.anchor;
      }
      if (m.fracWidth > globalFrac) {
        globalFrac = m.fracWidth;
      }
    }
    fileMetrics = { anchor: globalAnchor, fracWidth: globalFrac };
  }

  let runningAnchor = options.alignColumn > 0 ? options.alignColumn - 1 : 0;
  let runningFracWidth = 0;

  const renderedParts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === 'static-chunk') {
      renderedParts.push(seg.text);
      continue;
    }
    if (seg.kind === 'raw-pragma-chunk') {
      renderedParts.push(`${seg.prefixText}${seg.rawSlice}`);
      continue;
    }

    let metrics: AlignmentMetrics;
    switch (options.alignScope) {
      case 'none':
        metrics = { anchor: 0, fracWidth: 0 };
        break;
      case 'directive':
        metrics = computeBlockMetrics(seg.items, options, null);
        break;
      case 'file':
        metrics = fileMetrics;
        break;
      case 'file-grow-only': {
        const blockM = computeBlockMetrics(seg.items, options, maxAnchorCap);
        if (blockM.anchor > runningAnchor) {
          runningAnchor = blockM.anchor;
        }
        if (blockM.fracWidth > runningFracWidth) {
          runningFracWidth = blockM.fracWidth;
        }
        metrics = { anchor: runningAnchor, fracWidth: runningFracWidth };
        break;
      }
      case 'fixed': {
        const fixedCol = options.alignColumn > 0 ? options.alignColumn : 52;
        const blockM = computeBlockMetrics(seg.items, options, null);
        metrics = {
          anchor: Math.max(0, fixedCol - 1),
          fracWidth: blockM.fracWidth,
        };
        break;
      }
    }

    renderedParts.push(renderDirectiveBlock(seg, metrics, options));
  }

  return renderedParts.join('');
}
