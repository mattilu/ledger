import { FormatOptions } from '../options.js';
import { Doc, indent, printDoc } from './doc.js';

export interface AmountRowItem {
  readonly kind: 'amount-row';
  readonly leadingLines: readonly string[];
  readonly left: string;
  readonly intPart: string;
  readonly fracPart: string;
  readonly currency: string;
  readonly suffixDoc: Doc | null;
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
    // Outlier rows exceeding maxAnchorCap overflow locally with minGapSpaces,
    // so exclude both their anchor and fractional width from the shared grid
    // (padding non-outlier rows for an outlier's decimals would not align their
    // currencies with the already-overflowed outlier).
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

function formatAmountRowCore(
  row: AmountRowItem,
  metrics: AlignmentMetrics,
  options: FormatOptions,
): string {
  const { anchor: targetAnchor, fracWidth: targetFracWidth } = metrics;

  if (options.alignScope === 'none') {
    const gap = ' '.repeat(options.minGapSpaces);
    return `${row.left}${gap}${row.intPart}${row.fracPart} ${row.currency}`;
  }
  if (options.alignMode === 'currency') {
    const whole = `${row.intPart}${row.fracPart}`;
    const gapLen = Math.max(
      options.minGapSpaces,
      targetAnchor - row.left.length - whole.length,
    );
    return `${row.left}${' '.repeat(gapLen)}${whole} ${row.currency}`;
  }
  if (options.alignMode === 'decimal') {
    const gapLen = Math.max(
      options.minGapSpaces,
      targetAnchor - row.left.length - row.intPart.length,
    );
    return `${row.left}${' '.repeat(gapLen)}${row.intPart}${row.fracPart} ${row.currency}`;
  }

  const gapLen = Math.max(
    options.minGapSpaces,
    targetAnchor - row.left.length - row.intPart.length,
  );
  const afterFracCol =
    row.left.length + gapLen + row.intPart.length + row.fracPart.length;
  const currencyTarget = targetAnchor + targetFracWidth;
  const fracPadLen = Math.max(0, currencyTarget - afterFracCol);
  return `${row.left}${' '.repeat(gapLen)}${row.intPart}${row.fracPart}${' '.repeat(fracPadLen)} ${row.currency}`;
}

function renderDirectiveBlock(
  block: AlignableDirectiveBlock,
  metrics: AlignmentMetrics,
  options: FormatOptions,
): string {
  const preparedRows = block.items.map(item => {
    if (item.kind === 'amount-row') {
      const core = formatAmountRowCore(item, metrics, options);
      if (item.suffixDoc !== null) {
        const suffixRendered = printDoc(
          indent(options.indentWidth, item.suffixDoc),
          options.printWidth,
          core.length,
        );
        const fullCode = `${core}${suffixRendered}`;
        if (suffixRendered.includes('\n')) {
          return {
            kind: 'multi' as const,
            leadingLines: item.leadingLines,
            rendered:
              item.trailingComment !== null
                ? `${fullCode}  ${item.trailingComment}`
                : fullCode,
            metadataBlock: item.metadataBlock,
          };
        }
        return {
          kind: 'single' as const,
          leadingLines: item.leadingLines,
          code: fullCode,
          trailingComment: item.trailingComment,
          metadataBlock: item.metadataBlock,
        };
      }
      return {
        kind: 'single' as const,
        leadingLines: item.leadingLines,
        code: core,
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
      if (
        r.kind === 'single' &&
        r.trailingComment !== null &&
        r.code.length > maxCodeWidth
      ) {
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
  const floorAnchor = options.alignColumn > 0 ? options.alignColumn - 1 : 0;

  let fileMetrics: AlignmentMetrics = { anchor: 0, fracWidth: 0 };
  if (options.alignScope === 'file') {
    let globalAnchor = floorAnchor;
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

  const fixedAnchor = Math.max(
    0,
    (options.alignColumn > 0 ? options.alignColumn : 52) - 1,
  );

  let fixedFracWidth = 0;
  if (
    options.alignScope === 'fixed' &&
    options.alignMode === 'decimal-and-currency'
  ) {
    for (const seg of segments) {
      if (seg.kind !== 'aligned-directive') {
        continue;
      }
      const m = computeBlockMetrics(seg.items, options, fixedAnchor);
      if (m.fracWidth > fixedFracWidth) {
        fixedFracWidth = m.fracWidth;
      }
    }
  }

  let runningAnchor = floorAnchor;
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
      case 'directive': {
        const blockM = computeBlockMetrics(seg.items, options, null);
        metrics = {
          anchor: Math.max(floorAnchor, blockM.anchor),
          fracWidth: blockM.fracWidth,
        };
        break;
      }
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
        metrics = {
          anchor: fixedAnchor,
          fracWidth: fixedFracWidth,
        };
        break;
      }
    }

    renderedParts.push(renderDirectiveBlock(seg, metrics, options));
  }

  return renderedParts.join('');
}
