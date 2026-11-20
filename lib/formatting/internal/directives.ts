import { DirectiveCst } from '../../syntax/cst/directive.js';
import {
  BalanceDirectiveCst,
  BalanceEntryCst,
} from '../../syntax/cst/directives/balance.js';
import {
  AccountChoicePostingCst,
  AccountPostingCst,
  CostItemCst,
  CostSpecCst,
  PostingCst,
  PriceSpecCst,
  TransactionDirectiveCst,
} from '../../syntax/cst/directives/transaction.js';
import { RichToken } from '../../syntax/token.js';
import { TriviaItem } from '../../syntax/trivia.js';
import { FormatOptions } from '../options.js';
import {
  AlignableDirectiveBlock,
  DirectiveBodyItem,
  TopLevelFormattedSegment,
} from './align.js';
import { normalizeCommentText } from './comment.js';
import {
  firstDirectiveToken,
  leftmostCostItemValueToken,
  rightmostCostItemValueToken,
  rightmostExpressionToken,
} from './cst.js';
import {
  concat,
  Doc,
  emptyDoc,
  fill,
  group,
  hardline,
  indent,
  joinDocs,
  line,
  lineSuffix,
  printDoc,
  text,
} from './doc.js';
import {
  formatAmountDoc,
  formatDateText,
  formatExpressionDoc,
  formatMetadataEntries,
} from './expr.js';
import { splitDecimalNumberParts } from './number.js';
import { isFormatOffTrivia, isFormatOnTrivia } from './pragma.js';
import { formatRuleBlockDoc } from './rules.js';
import {
  collectInteriorComments,
  formatClosingLeadingTrivia,
  formatLeadingBlockLines,
  indentStr,
  lastLineLength,
  shiftComments,
  trailingCommentText,
} from './trivia.js';

function formatCostItemDoc(
  item: CostItemCst,
  isLast: boolean,
  options: FormatOptions,
): Doc {
  const firstTok = leftmostCostItemValueToken(item.value);
  const lastTok = item.commaToken ?? rightmostCostItemValueToken(item.value);
  const shifted = shiftComments(
    collectInteriorComments(firstTok, lastTok),
    trailingCommentText(lastTok),
  );

  const leadingParts: Doc[] = [];
  for (const t of firstTok.leadingTrivia) {
    if (t.kind === 'blank-lines') {
      leadingParts.push(hardline);
    } else {
      leadingParts.push(text(normalizeCommentText(t.text)), hardline);
    }
  }
  for (const c of shifted.hoisted) {
    leadingParts.push(text(c), hardline);
  }

  let valDoc: Doc;
  switch (item.value.kind) {
    case 'amount':
      valDoc = formatAmountDoc(item.value.amount, options);
      break;
    case 'currency':
    case 'tag':
      valDoc = text(item.value.token.text);
      break;
    case 'date':
      valDoc = text(formatDateText(item.value.date));
      break;
  }

  const withComma = isLast ? valDoc : concat([valDoc, text(',')]);
  const withTrail =
    shifted.trailing !== null
      ? options.costSpecWrapStyle === 'compact'
        ? concat([withComma, lineSuffix(`  ${shifted.trailing}`)])
        : concat([withComma, text(`  ${shifted.trailing}`)])
      : withComma;

  return leadingParts.length > 0
    ? concat([...leadingParts, withTrail])
    : withTrail;
}

function formatCostSpecDoc(
  costSpec: CostSpecCst,
  options: FormatOptions,
  closeTrailingComment: string | null = null,
): Doc {
  const openTrailing = trailingCommentText(costSpec.openToken);
  const hasInteriorComments =
    collectInteriorComments(costSpec.openToken, costSpec.closeToken).length > 0;

  if (costSpec.items.length === 0 && !hasInteriorComments) {
    return concat([
      text(costSpec.openToken.text),
      text(costSpec.closeToken.text),
      closeTrailingComment !== null
        ? text(`  ${closeTrailingComment}`)
        : emptyDoc,
    ]);
  }

  const itemDocs = costSpec.items.map((item, idx) =>
    formatCostItemDoc(item, idx === costSpec.items.length - 1, options),
  );

  const closeLeading = formatClosingLeadingTrivia(
    costSpec.closeToken.leadingTrivia,
  );

  let itemsBody: Doc = emptyDoc;
  if (itemDocs.length > 0) {
    if (options.costSpecWrapStyle === 'compact') {
      const fillParts: Doc[] = [];
      for (let i = 0; i < itemDocs.length; i++) {
        if (i > 0) {
          fillParts.push(line);
        }
        fillParts.push(itemDocs[i]);
      }
      itemsBody = concat([line, fill(fillParts)]);
    } else {
      itemsBody = concat([line, joinDocs(line, itemDocs)]);
    }
  }

  return group(
    concat([
      text(costSpec.openToken.text),
      openTrailing !== null ? text(`  ${openTrailing}`) : emptyDoc,
      indent(options.indentWidth, concat([itemsBody, closeLeading])),
      line,
      text(costSpec.closeToken.text),
      closeTrailingComment !== null
        ? text(`  ${closeTrailingComment}`)
        : emptyDoc,
    ]),
    hasInteriorComments,
  );
}

function formatPriceSpecDoc(
  priceSpec: PriceSpecCst,
  options: FormatOptions,
): Doc {
  return concat([
    text(`${priceSpec.opToken.text} `),
    formatAmountDoc(priceSpec.amount, options),
  ]);
}

function formatAccountPostingItem(
  posting: AccountPostingCst,
  options: FormatOptions,
): DirectiveBodyItem {
  const firstTok = posting.flagToken ?? posting.accountToken;
  let finalToken: RichToken = posting.accountToken;
  if (posting.priceSpec !== null) {
    finalToken = posting.priceSpec.amount.currencyToken;
  } else if (posting.costSpec !== null) {
    finalToken = posting.costSpec.closeToken;
  } else if (posting.amount !== null) {
    finalToken = posting.amount.currencyToken;
  }

  const costHasInteriorComments =
    posting.costSpec !== null &&
    collectInteriorComments(
      posting.costSpec.openToken,
      posting.costSpec.closeToken,
    ).length > 0;

  let hoistedComments: readonly string[];
  let trailingComment: string | null;
  let closeTrailingOnCost: string | null = null;
  let beforePriceComments: readonly string[] = [];

  if (!costHasInteriorComments) {
    // No interior comments inside `{ ... }`: shift all non-canonical comments
    // across the entire posting into canonical leading/trailing slots.
    const shifted = shiftComments(
      collectInteriorComments(firstTok, finalToken),
      trailingCommentText(finalToken),
    );
    hoistedComments = shifted.hoisted;
    trailingComment = shifted.trailing;
  } else {
    // Cost spec owns canonical interior comments: hoist any pre-cost comments
    // above the posting so they stay before the cost spec's comments, and keep
    // any post-cost comments after `}` / at the end of the posting.
    hoistedComments = collectInteriorComments(
      firstTok,
      posting.costSpec!.openToken,
    );
    if (posting.priceSpec === null) {
      trailingComment = trailingCommentText(posting.costSpec!.closeToken);
    } else {
      const priceInterior = collectInteriorComments(
        posting.costSpec!.closeToken,
        posting.priceSpec.amount.currencyToken,
      );
      const priceTrailing = trailingCommentText(
        posting.priceSpec.amount.currencyToken,
      );
      if (priceTrailing === null && priceInterior.length === 1) {
        trailingComment = priceInterior[0];
      } else {
        closeTrailingOnCost = priceInterior[0] ?? null;
        beforePriceComments = priceInterior.slice(1);
        trailingComment = priceTrailing;
      }
    }
  }

  const leadingLines = formatLeadingBlockLines(
    firstTok.leadingTrivia,
    options.indentWidth,
    1,
    hoistedComments,
  );
  const metaLines = formatMetadataEntries(posting.metadata, 2, options);
  const metadataBlock = metaLines.join('\n');

  const leftPrefix =
    posting.flagToken !== null
      ? `${indentStr(options.indentWidth, 1)}${posting.flagToken.text} ${posting.accountToken.text}`
      : `${indentStr(options.indentWidth, 1)}${posting.accountToken.text}`;

  const suffixParts: Doc[] = [];
  if (posting.costSpec !== null) {
    suffixParts.push(
      text(' '),
      formatCostSpecDoc(posting.costSpec, options, closeTrailingOnCost),
    );
  }
  if (posting.priceSpec !== null) {
    const forcePriceBreak =
      closeTrailingOnCost !== null || beforePriceComments.length > 0;
    const priceBlockParts: Doc[] = [];
    for (const c of beforePriceComments) {
      priceBlockParts.push(hardline, text(c));
    }
    priceBlockParts.push(
      forcePriceBreak ? hardline : line,
      formatPriceSpecDoc(posting.priceSpec, options),
    );
    suffixParts.push(
      group(
        indent(options.indentWidth, concat(priceBlockParts)),
        forcePriceBreak,
      ),
    );
  }

  const suffixDoc: Doc | null =
    suffixParts.length > 0 ? concat(suffixParts) : null;

  const renderSuffix = (initialColumn: number): string =>
    suffixDoc !== null
      ? printDoc(
          indent(options.indentWidth, suffixDoc),
          options.printWidth,
          initialColumn,
        )
      : '';

  if (posting.amount === null) {
    const suffixRendered = renderSuffix(leftPrefix.length);
    const code = `${leftPrefix}${suffixRendered}`;

    if (code.includes('\n')) {
      return {
        kind: 'multiline-row',
        leadingLines,
        rendered:
          trailingComment !== null ? `${code}  ${trailingComment}` : code,
        metadataBlock,
      };
    }

    return {
      kind: 'plain-row',
      leadingLines,
      code,
      trailingComment,
      metadataBlock,
    };
  }

  const currencyText = posting.amount.currencyToken.text;
  const amountStartCol = leftPrefix.length + options.minGapSpaces;
  const amountWithCurrency = printDoc(
    indent(
      options.indentWidth,
      concat([
        formatExpressionDoc(posting.amount.amount, options),
        text(` ${currencyText}`),
      ]),
    ),
    options.printWidth,
    amountStartCol,
  );
  if (amountWithCurrency.includes('\n')) {
    const suffixRendered = renderSuffix(lastLineLength(amountWithCurrency));
    const code = `${leftPrefix}${' '.repeat(options.minGapSpaces)}${amountWithCurrency}${suffixRendered}`;
    return {
      kind: 'multiline-row',
      leadingLines,
      rendered: trailingComment !== null ? `${code}  ${trailingComment}` : code,
      metadataBlock,
    };
  }

  const formattedExpr = amountWithCurrency.slice(
    0,
    amountWithCurrency.length - currencyText.length - 1,
  );
  const { intPart, fracPart } = splitDecimalNumberParts(formattedExpr);

  return {
    kind: 'amount-row',
    leadingLines,
    left: leftPrefix,
    intPart,
    fracPart,
    currency: currencyText,
    suffixDoc,
    trailingComment,
    metadataBlock,
  };
}

function formatAccountChoicePostingItem(
  posting: AccountChoicePostingCst,
  options: FormatOptions,
): DirectiveBodyItem {
  const firstTok = posting.flagToken ?? posting.chooseToken;
  const metaLines = formatMetadataEntries(posting.metadata, 2, options);
  const metadataBlock = metaLines.join('\n');
  const flagPrefix =
    posting.flagToken !== null ? `${posting.flagToken.text} ` : '';

  if (posting.target.type === 'ref') {
    const shifted = shiftComments(
      collectInteriorComments(firstTok, posting.target.nameToken),
      trailingCommentText(posting.target.nameToken),
    );
    const leadingLines = formatLeadingBlockLines(
      firstTok.leadingTrivia,
      options.indentWidth,
      1,
      shifted.hoisted,
    );
    const code = `${indentStr(options.indentWidth, 1)}${flagPrefix}choose account ${posting.target.nameToken.text}`;
    return {
      kind: 'plain-row',
      leadingLines,
      code,
      trailingComment: shifted.trailing,
      metadataBlock,
    };
  }

  const block = posting.target.block;
  const shifted = shiftComments(
    collectInteriorComments(firstTok, block.openBrace),
    trailingCommentText(block.openBrace),
  );
  const leadingLines = formatLeadingBlockLines(
    firstTok.leadingTrivia,
    options.indentWidth,
    1,
    shifted.hoisted,
  );

  const fullDoc = concat([
    text(`${indentStr(options.indentWidth, 1)}${flagPrefix}choose account `),
    indent(
      options.indentWidth,
      formatRuleBlockDoc(block, true, options, shifted.trailing),
    ),
  ]);
  const rendered = printDoc(fullDoc, options.printWidth);
  const trailingComment = trailingCommentText(block.closeBrace);

  if (!rendered.includes('\n')) {
    return {
      kind: 'plain-row',
      leadingLines,
      code: rendered,
      trailingComment,
      metadataBlock,
    };
  }

  return {
    kind: 'multiline-row',
    leadingLines,
    rendered:
      trailingComment !== null ? `${rendered}  ${trailingComment}` : rendered,
    metadataBlock,
  };
}

function formatPostingItem(
  posting: PostingCst,
  options: FormatOptions,
): DirectiveBodyItem {
  return posting.type === 'account-posting'
    ? formatAccountPostingItem(posting, options)
    : formatAccountChoicePostingItem(posting, options);
}

function formatBalanceEntryItem(
  entry: BalanceEntryCst,
  options: FormatOptions,
): DirectiveBodyItem {
  const finalToken =
    entry.approx !== null
      ? rightmostExpressionToken(entry.approx.tolerance)
      : entry.amount.currencyToken;

  const shifted = shiftComments(
    collectInteriorComments(entry.accountToken, finalToken),
    trailingCommentText(finalToken),
  );
  const leadingLines = formatLeadingBlockLines(
    entry.accountToken.leadingTrivia,
    options.indentWidth,
    1,
    shifted.hoisted,
  );

  const left = `${indentStr(options.indentWidth, 1)}${entry.accountToken.text}`;
  const currencyText = entry.amount.currencyToken.text;
  const amountStartCol = left.length + options.minGapSpaces;
  const amountWithCurrency = printDoc(
    indent(
      options.indentWidth,
      concat([
        formatExpressionDoc(entry.amount.amount, options),
        text(` ${currencyText}`),
      ]),
    ),
    options.printWidth,
    amountStartCol,
  );
  const suffixDoc: Doc | null =
    entry.approx !== null
      ? concat([
          text(' ~ '),
          formatExpressionDoc(entry.approx.tolerance, options),
        ])
      : null;

  if (amountWithCurrency.includes('\n')) {
    const suffix =
      suffixDoc !== null
        ? printDoc(
            indent(options.indentWidth, suffixDoc),
            options.printWidth,
            lastLineLength(amountWithCurrency),
          )
        : '';
    const code = `${left}${' '.repeat(options.minGapSpaces)}${amountWithCurrency}${suffix}`;
    return {
      kind: 'multiline-row',
      leadingLines,
      rendered:
        shifted.trailing !== null ? `${code}  ${shifted.trailing}` : code,
      metadataBlock: '',
    };
  }

  const formattedExpr = amountWithCurrency.slice(
    0,
    amountWithCurrency.length - currencyText.length - 1,
  );
  const { intPart, fracPart } = splitDecimalNumberParts(formattedExpr);

  return {
    kind: 'amount-row',
    leadingLines,
    left,
    intPart,
    fracPart,
    currency: currencyText,
    suffixDoc,
    trailingComment: shifted.trailing,
    metadataBlock: '',
  };
}

function formatLeadingTopLevelPrefix(
  trivia: readonly TriviaItem[],
  isFirstSegment: boolean,
  prevSegmentWasMultiline: boolean,
  currentSegmentIsMultiline = false,
  hoistedComments: readonly string[] = [],
): string {
  const out: string[] = [];

  if (!isFirstSegment) {
    out.push('\n');
    const startsWithBlank =
      trivia.length > 0 && trivia[0].kind === 'blank-lines';
    if (
      (prevSegmentWasMultiline || currentSegmentIsMultiline) &&
      !startsWithBlank
    ) {
      out.push('\n');
    }
  }

  for (const item of trivia) {
    if (item.kind === 'blank-lines') {
      if (!isFirstSegment || out.length > 0) {
        out.push('\n');
      }
    } else {
      out.push(`${normalizeCommentText(item.text)}\n`);
    }
  }

  for (const comment of hoistedComments) {
    out.push(`${comment}\n`);
  }

  return out.join('');
}

function appendTrailingComment(
  rendered: string,
  trailing: string | null,
): string {
  return trailing !== null ? `${rendered}  ${trailing}` : rendered;
}

function formatTransactionDirective(
  directive: TransactionDirectiveCst,
  triviaOverride: readonly TriviaItem[],
  isFirstSegment: boolean,
  prevWasMultiline: boolean,
  options: FormatOptions,
): AlignableDirectiveBlock {
  let flagText = directive.flagToken.text;
  if (flagText !== '!') {
    if (options.transactionFlagStyle === 'star') {
      flagText = '*';
    } else if (options.transactionFlagStyle === 'txn') {
      flagText = 'txn';
    }
  }

  const shifted = shiftComments(
    collectInteriorComments(
      directive.date.dateToken,
      directive.descriptionToken,
    ),
    trailingCommentText(directive.descriptionToken),
  );
  const headerRendered = appendTrailingComment(
    `${formatDateText(directive.date)} ${flagText} ${directive.descriptionToken.text}`,
    shifted.trailing,
  );
  const metaLines = formatMetadataEntries(directive.metadata, 1, options);
  const headerAndMetaLines = [headerRendered, ...metaLines];
  const items = directive.postings.map(p => formatPostingItem(p, options));

  const isMultiline = metaLines.length > 0 || items.length > 0;
  const prefixText = formatLeadingTopLevelPrefix(
    triviaOverride,
    isFirstSegment,
    prevWasMultiline,
    isMultiline,
    shifted.hoisted,
  );

  return {
    kind: 'aligned-directive',
    prefixText,
    headerAndMetaLines,
    items,
    isMultiline,
  };
}

function formatBalanceDirective(
  directive: BalanceDirectiveCst,
  triviaOverride: readonly TriviaItem[],
  isFirstSegment: boolean,
  prevWasMultiline: boolean,
  options: FormatOptions,
): AlignableDirectiveBlock {
  const shifted = shiftComments(
    collectInteriorComments(directive.date.dateToken, directive.keywordToken),
    trailingCommentText(directive.keywordToken),
  );
  const headerRendered = appendTrailingComment(
    `${formatDateText(directive.date)} ${directive.keywordToken.text}`,
    shifted.trailing,
  );
  const metaLines = formatMetadataEntries(directive.metadata, 1, options);
  const headerAndMetaLines = [headerRendered, ...metaLines];
  const items = directive.balances.map(b => formatBalanceEntryItem(b, options));

  const isMultiline = metaLines.length > 0 || items.length > 0;
  const prefixText = formatLeadingTopLevelPrefix(
    triviaOverride,
    isFirstSegment,
    prevWasMultiline,
    isMultiline,
    shifted.hoisted,
  );

  return {
    kind: 'aligned-directive',
    prefixText,
    headerAndMetaLines,
    items,
    isMultiline,
  };
}

function formatDirective(
  directive: DirectiveCst,
  triviaOverride: readonly TriviaItem[],
  isFirstSegment: boolean,
  prevWasMultiline: boolean,
  options: FormatOptions,
): TopLevelFormattedSegment {
  if (directive.type === 'transaction') {
    return formatTransactionDirective(
      directive,
      triviaOverride,
      isFirstSegment,
      prevWasMultiline,
      options,
    );
  }
  if (directive.type === 'balance') {
    return formatBalanceDirective(
      directive,
      triviaOverride,
      isFirstSegment,
      prevWasMultiline,
      options,
    );
  }

  let headerRendered: string;
  let hoistedComments: readonly string[];

  switch (directive.type) {
    case 'load': {
      const shifted = shiftComments(
        collectInteriorComments(directive.keywordToken, directive.pathToken),
        trailingCommentText(directive.pathToken),
      );
      hoistedComments = shifted.hoisted;
      headerRendered = appendTrailingComment(
        `${directive.keywordToken.text} ${directive.pathToken.text}`,
        shifted.trailing,
      );
      break;
    }
    case 'option': {
      const shifted = shiftComments(
        collectInteriorComments(directive.keywordToken, directive.valueToken),
        trailingCommentText(directive.valueToken),
      );
      hoistedComments = shifted.hoisted;
      headerRendered = appendTrailingComment(
        `${directive.keywordToken.text} ${directive.nameToken.text} ${directive.valueToken.text}`,
        shifted.trailing,
      );
      break;
    }
    case 'close': {
      const shifted = shiftComments(
        collectInteriorComments(
          directive.date.dateToken,
          directive.accountToken,
        ),
        trailingCommentText(directive.accountToken),
      );
      hoistedComments = shifted.hoisted;
      headerRendered = appendTrailingComment(
        `${formatDateText(directive.date)} ${directive.keywordToken.text} ${directive.accountToken.text}`,
        shifted.trailing,
      );
      break;
    }
    case 'currency':
    case 'commodity': {
      const kwText =
        options.currencyKeywordStyle === 'preserve'
          ? directive.keywordToken.text
          : options.currencyKeywordStyle;
      const shifted = shiftComments(
        collectInteriorComments(
          directive.date.dateToken,
          directive.currencyToken,
        ),
        trailingCommentText(directive.currencyToken),
      );
      hoistedComments = shifted.hoisted;
      headerRendered = appendTrailingComment(
        `${formatDateText(directive.date)} ${kwText} ${directive.currencyToken.text}`,
        shifted.trailing,
      );
      break;
    }
    case 'open': {
      const lastTok =
        directive.currencyTokens.length > 0
          ? directive.currencyTokens[directive.currencyTokens.length - 1]
          : directive.accountToken;
      const shifted = shiftComments(
        collectInteriorComments(directive.date.dateToken, lastTok),
        trailingCommentText(lastTok),
      );
      hoistedComments = shifted.hoisted;
      const openDoc = group(
        concat([
          text(
            `${formatDateText(directive.date)} ${directive.keywordToken.text} ${directive.accountToken.text}`,
          ),
          indent(
            options.indentWidth,
            concat(
              directive.currencyTokens.flatMap(tok => [line, text(tok.text)]),
            ),
          ),
        ]),
      );
      headerRendered = appendTrailingComment(
        printDoc(openDoc, options.printWidth),
        shifted.trailing,
      );
      break;
    }
    case 'price': {
      const lastTok = directive.price.currencyToken;
      const shifted = shiftComments(
        collectInteriorComments(directive.date.dateToken, lastTok),
        trailingCommentText(lastTok),
      );
      hoistedComments = shifted.hoisted;
      const priceDoc = group(
        concat([
          text(
            `${formatDateText(directive.date)} ${directive.keywordToken.text} ${directive.currencyToken.text} `,
          ),
          indent(
            options.indentWidth,
            formatAmountDoc(directive.price, options),
          ),
        ]),
      );
      headerRendered = appendTrailingComment(
        printDoc(priceDoc, options.printWidth),
        shifted.trailing,
      );
      break;
    }
    case 'account-rule': {
      const shifted = shiftComments(
        collectInteriorComments(
          directive.keywordToken,
          directive.block.openBrace,
        ),
        trailingCommentText(directive.block.openBrace),
      );
      hoistedComments = shifted.hoisted;
      const ruleDoc = concat([
        text(`${directive.keywordToken.text} ${directive.nameToken.text} `),
        formatRuleBlockDoc(directive.block, false, options, shifted.trailing),
      ]);
      headerRendered = appendTrailingComment(
        printDoc(ruleDoc, options.printWidth),
        trailingCommentText(directive.block.closeBrace),
      );
      break;
    }
  }

  const metaLines = formatMetadataEntries(directive.metadata, 1, options);
  const bodyLines = [headerRendered, ...metaLines].join('\n');
  const isMultiline =
    directive.type === 'account-rule' ||
    headerRendered.includes('\n') ||
    metaLines.length > 0;
  const prefixText = formatLeadingTopLevelPrefix(
    triviaOverride,
    isFirstSegment,
    prevWasMultiline,
    isMultiline,
    hoistedComments,
  );

  return {
    kind: 'static-chunk',
    text: `${prefixText}${bodyLines}`,
    isMultiline,
  };
}

function lineStartOffset(source: string, offset: number): number {
  let pos = offset;
  while (pos > 0) {
    const ch = source.charCodeAt(pos - 1);
    if (ch === 32 || ch === 9) {
      pos--;
    } else {
      break;
    }
  }
  return pos;
}

/**
 * Formats all top-level directives, comments, and `; ledger-fmt: off/on`
 * pragma regions into ordered alignment-ready segments.
 *
 * @param source Raw Ledger source text (used to slice verbatim pragma blocks).
 * @param directives Parsed top-level directive CST nodes.
 * @param eofTrivia Trailing trivia items following the last directive token.
 * @param options Resolved formatting options.
 * @returns Ordered top-level segments ready for `renderSegments`.
 */
export function buildTopLevelSegments(
  source: string,
  directives: readonly DirectiveCst[],
  eofTrivia: readonly TriviaItem[],
  options: FormatOptions,
): TopLevelFormattedSegment[] {
  const segments: TopLevelFormattedSegment[] = [];
  let isFirst = true;
  let prevWasMultiline = false;

  let pragmaOffStartOffset: number | null = null;
  let pragmaBeforeOffTrivia: readonly TriviaItem[] = [];
  let pragmaIsFirst = false;
  let pragmaPrevWasMultiline = false;

  const flushPragmaRange = (endOffset: number) => {
    if (pragmaOffStartOffset === null) {
      return;
    }
    const rawSlice = source
      .slice(pragmaOffStartOffset, endOffset)
      .replace(/\r\n?/g, '\n')
      .trimEnd();
    const isMulti = rawSlice.includes('\n');
    const prefixText = formatLeadingTopLevelPrefix(
      pragmaBeforeOffTrivia,
      pragmaIsFirst,
      pragmaPrevWasMultiline,
      isMulti,
    );
    segments.push({
      kind: 'raw-pragma-chunk',
      prefixText,
      rawSlice,
      isMultiline: isMulti,
    });
    pragmaOffStartOffset = null;
    pragmaBeforeOffTrivia = [];
    isFirst = false;
    prevWasMultiline = isMulti;
  };

  for (const directive of directives) {
    const firstTok = firstDirectiveToken(directive);
    const trivia = firstTok.leadingTrivia;
    let remainingStartIdx = 0;

    for (let i = 0; i < trivia.length; i++) {
      const item = trivia[i];
      if (pragmaOffStartOffset === null && isFormatOffTrivia(item)) {
        pragmaBeforeOffTrivia = trivia.slice(remainingStartIdx, i);
        pragmaIsFirst = isFirst;
        pragmaPrevWasMultiline = prevWasMultiline;
        pragmaOffStartOffset = lineStartOffset(source, item.span.start.offset);
      } else if (pragmaOffStartOffset !== null && isFormatOnTrivia(item)) {
        flushPragmaRange(item.span.end.offset);
        remainingStartIdx = i + 1;
      }
    }

    if (pragmaOffStartOffset !== null) {
      // Entire directive sits inside an active ledger-fmt: off block.
      continue;
    }

    const activeTrivia = trivia.slice(remainingStartIdx);
    const seg = formatDirective(
      directive,
      activeTrivia,
      isFirst,
      prevWasMultiline,
      options,
    );
    segments.push(seg);
    isFirst = false;
    prevWasMultiline = seg.isMultiline;
  }

  // Handle eofTrivia (and any unclosed or EOF-closed pragma blocks).
  let eofStartIdx = 0;
  for (let i = 0; i < eofTrivia.length; i++) {
    const item = eofTrivia[i];
    if (pragmaOffStartOffset === null && isFormatOffTrivia(item)) {
      pragmaBeforeOffTrivia = eofTrivia.slice(eofStartIdx, i);
      pragmaIsFirst = isFirst;
      pragmaPrevWasMultiline = prevWasMultiline;
      pragmaOffStartOffset = lineStartOffset(source, item.span.start.offset);
    } else if (pragmaOffStartOffset !== null && isFormatOnTrivia(item)) {
      flushPragmaRange(item.span.end.offset);
      eofStartIdx = i + 1;
    }
  }

  if (pragmaOffStartOffset !== null) {
    flushPragmaRange(source.length);
  } else {
    const remainingEof = eofTrivia.slice(eofStartIdx);
    const hasComments = remainingEof.some(t => t.kind === 'comment');
    if (hasComments) {
      const prefix = formatLeadingTopLevelPrefix(
        remainingEof,
        isFirst,
        prevWasMultiline,
      );
      // Remove trailing '\n' because render will append single final '\n'.
      const trimmed = prefix.endsWith('\n') ? prefix.slice(0, -1) : prefix;
      segments.push({
        kind: 'static-chunk',
        text: trimmed,
        isMultiline: false,
      });
    }
  }

  return segments;
}
