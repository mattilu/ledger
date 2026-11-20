import { either as E } from 'fp-ts';

import { AmountCst } from '../syntax/cst/amount.js';
import {
  ConditionExpressionCst,
  ConditionLiteralCst,
} from '../syntax/cst/condition.js';
import { DateCst } from '../syntax/cst/date.js';
import { DirectiveCst } from '../syntax/cst/directive.js';
import {
  AccountChoiceOtherwiseOutcomeCst,
  AccountChoiceOutcomeCst,
  RuleBlockCst,
  RuleClauseCst,
} from '../syntax/cst/directives/account-rule.js';
import {
  BalanceDirectiveCst,
  BalanceEntryCst,
} from '../syntax/cst/directives/balance.js';
import {
  AccountChoicePostingCst,
  AccountPostingCst,
  CostItemCst,
  CostSpecCst,
  PostingCst,
  PriceSpecCst,
  TransactionDirectiveCst,
} from '../syntax/cst/directives/transaction.js';
import { ExpressionCst } from '../syntax/cst/expression.js';
import { MetadataEntryCst, MetadataValueCst } from '../syntax/cst/metadata.js';
import { parseSyntax } from '../syntax/parser.js';
import { RichToken } from '../syntax/token.js';
import { TriviaItem } from '../syntax/trivia.js';
import { FormatError } from './error.js';
import {
  AlignableDirectiveBlock,
  DirectiveBodyItem,
  renderSegments,
  TopLevelFormattedSegment,
} from './internal/align.js';
import { normalizeCommentText } from './internal/comment.js';
import {
  breakParent,
  concat,
  Doc,
  emptyDoc,
  group,
  hardline,
  ifBreak,
  indent,
  joinDocs,
  line,
  lineSuffix,
  printDoc,
  softline,
  text,
} from './internal/doc.js';
import {
  formatNumberLiteral,
  splitDecimalNumberParts,
} from './internal/number.js';
import { isFormatOffTrivia, isFormatOnTrivia } from './internal/pragma.js';
import { verifyFormattedOutput } from './internal/verify.js';
import {
  DEFAULT_FORMAT_OPTIONS,
  FormatOptions,
  resolveFormatOptions,
} from './options.js';

export * from './error.js';
export * from './options.js';

function hasAnyTrivia(token: RichToken, ignoreTrailing = false): boolean {
  return (
    token.leadingTrivia.length > 0 ||
    (!ignoreTrailing && token.trailingComment !== null)
  );
}

function expressionHasTrivia(
  expr: ExpressionCst,
  ignoreRightmostTrailing = false,
): boolean {
  switch (expr.type) {
    case 'literal':
      return hasAnyTrivia(expr.token, ignoreRightmostTrailing);
    case 'unary':
      return (
        hasAnyTrivia(expr.opToken) ||
        expressionHasTrivia(expr.expr, ignoreRightmostTrailing)
      );
    case 'binary':
      return (
        expressionHasTrivia(expr.lhs) ||
        hasAnyTrivia(expr.opToken) ||
        expressionHasTrivia(expr.rhs, ignoreRightmostTrailing)
      );
    case 'paren':
      return (
        hasAnyTrivia(expr.openParen) ||
        expressionHasTrivia(expr.expr) ||
        hasAnyTrivia(expr.closeParen, ignoreRightmostTrailing)
      );
  }
}

function rightmostExpressionToken(expr: ExpressionCst): RichToken {
  switch (expr.type) {
    case 'literal':
      return expr.token;
    case 'unary':
      return rightmostExpressionToken(expr.expr);
    case 'binary':
      return rightmostExpressionToken(expr.rhs);
    case 'paren':
      return expr.closeParen;
  }
}

function dateHasTrivia(date: DateCst, ignoreLastTrailing = false): boolean {
  if (date.timezoneToken !== null) {
    return (
      hasAnyTrivia(date.dateToken) ||
      (date.timeToken !== null && hasAnyTrivia(date.timeToken)) ||
      hasAnyTrivia(date.timezoneToken, ignoreLastTrailing)
    );
  }
  if (date.timeToken !== null) {
    return (
      hasAnyTrivia(date.dateToken) ||
      hasAnyTrivia(date.timeToken, ignoreLastTrailing)
    );
  }
  return hasAnyTrivia(date.dateToken, ignoreLastTrailing);
}

function amountHasTrivia(
  amount: AmountCst,
  ignoreCurrencyTrailing = false,
): boolean {
  return (
    expressionHasTrivia(amount.amount) ||
    hasAnyTrivia(amount.currencyToken, ignoreCurrencyTrailing)
  );
}

function costSpecHasInteriorTrivia(
  costSpec: CostSpecCst,
  ignoreCloseTrailing: boolean,
): boolean {
  if (hasAnyTrivia(costSpec.openToken)) {
    return true;
  }
  if (hasAnyTrivia(costSpec.closeToken, ignoreCloseTrailing)) {
    return true;
  }
  for (const item of costSpec.items) {
    if (item.commaToken !== null && hasAnyTrivia(item.commaToken)) {
      return true;
    }
    switch (item.value.kind) {
      case 'amount':
        if (amountHasTrivia(item.value.amount)) {
          return true;
        }
        break;
      case 'currency':
      case 'tag':
        if (hasAnyTrivia(item.value.token)) {
          return true;
        }
        break;
      case 'date':
        if (dateHasTrivia(item.value.date)) {
          return true;
        }
        break;
    }
  }
  return false;
}

const checkConditionLiteral = (v: ConditionLiteralCst): boolean => {
  switch (v.type) {
    case 'identifier':
    case 'string':
    case 'account':
    case 'currency':
      return hasAnyTrivia(v.token);
    case 'number':
      return expressionHasTrivia(v.expr);
    case 'amount':
      return amountHasTrivia(v.amount);
    case 'date':
      return dateHasTrivia(v.date);
    case 'duration':
      return hasAnyTrivia(v.valueToken) || hasAnyTrivia(v.unitToken);
  }
};

function ruleBlockHasComments(block: RuleBlockCst): boolean {
  const checkCondition = (cond: ConditionExpressionCst): boolean => {
    switch (cond.type) {
      case 'comparison':
        return (
          hasAnyTrivia(cond.attributeToken) ||
          cond.operator.tokens.some(t => hasAnyTrivia(t)) ||
          checkConditionLiteral(cond.value)
        );
      case 'not':
        return hasAnyTrivia(cond.notToken) || checkCondition(cond.expr);
      case 'and':
      case 'or':
        return (
          checkCondition(cond.lhs) ||
          hasAnyTrivia(cond.opToken) ||
          checkCondition(cond.rhs)
        );
      case 'paren':
        return (
          hasAnyTrivia(cond.openParen) ||
          checkCondition(cond.expr) ||
          hasAnyTrivia(cond.closeParen)
        );
    }
  };

  const checkOutcome = (out: AccountChoiceOutcomeCst): boolean => {
    switch (out.type) {
      case 'account':
        return hasAnyTrivia(out.accountToken);
      case 'break':
        return hasAnyTrivia(out.breakToken);
      case 'fail':
        return (
          hasAnyTrivia(out.failToken) ||
          (out.messageToken !== null && hasAnyTrivia(out.messageToken))
        );
    }
  };

  if (hasAnyTrivia(block.openBrace) || hasAnyTrivia(block.closeBrace, true)) {
    return true;
  }
  for (const clause of block.clauses) {
    if (clause.commaToken !== null && hasAnyTrivia(clause.commaToken)) {
      return true;
    }
    if (hasAnyTrivia(clause.colonToken)) {
      return true;
    }
    if (clause.type === 'when') {
      if (
        hasAnyTrivia(clause.whenToken) ||
        checkCondition(clause.condition) ||
        checkOutcome(clause.outcome)
      ) {
        return true;
      }
    } else if (
      hasAnyTrivia(clause.otherwiseToken) ||
      checkOutcome(clause.outcome)
    ) {
      return true;
    }
  }
  return false;
}

class FormatterBuilder {
  constructor(readonly options: FormatOptions) {}

  private indentStr(levels = 1): string {
    return ' '.repeat(this.options.indentWidth * levels);
  }

  private emitInteriorLeadingTrivia(items: readonly TriviaItem[]): Doc {
    if (items.length === 0) {
      return emptyDoc;
    }
    const parts: Doc[] = [];
    for (const item of items) {
      if (item.kind === 'blank-lines') {
        parts.push(hardline);
      } else {
        parts.push(
          text(normalizeCommentText(item.text)),
          hardline,
          breakParent,
        );
      }
    }
    return concat(parts);
  }

  private tokenDoc(
    token: RichToken,
    options?: {
      readonly overrideText?: string;
      readonly skipLeading?: boolean;
      readonly skipTrailing?: boolean;
    },
  ): Doc {
    const parts: Doc[] = [];
    if (!options?.skipLeading && token.leadingTrivia.length > 0) {
      parts.push(this.emitInteriorLeadingTrivia(token.leadingTrivia));
    }
    parts.push(text(options?.overrideText ?? token.text));
    if (!options?.skipTrailing && token.trailingComment !== null) {
      parts.push(
        lineSuffix(`  ${normalizeCommentText(token.trailingComment.text)}`),
      );
    }
    return concat(parts);
  }

  private formatLeadingBlockLines(
    trivia: readonly TriviaItem[],
    indentLevels: number,
  ): string[] {
    const pad = this.indentStr(indentLevels);
    const lines: string[] = [];
    for (const item of trivia) {
      if (item.kind === 'blank-lines') {
        lines.push('');
      } else {
        lines.push(`${pad}${normalizeCommentText(item.text)}`);
      }
    }
    return lines;
  }

  private formatDateDoc(date: DateCst, skipFirstLeading = false): Doc {
    const parts: Doc[] = [
      this.tokenDoc(date.dateToken, { skipLeading: skipFirstLeading }),
    ];
    if (date.timeToken !== null) {
      parts.push(line, this.tokenDoc(date.timeToken));
    }
    if (date.timezoneToken !== null) {
      parts.push(line, this.tokenDoc(date.timezoneToken));
    }
    return group(concat(parts));
  }

  private expressionStartsWithSign(expr: ExpressionCst): boolean {
    switch (expr.type) {
      case 'literal':
        return expr.token.text.startsWith('-');
      case 'unary':
        return expr.op === '-' || expr.op === '+';
      case 'binary':
        return this.expressionStartsWithSign(expr.lhs);
      case 'paren':
        return false;
    }
  }

  private formatExpressionDoc(
    expr: ExpressionCst,
    opts?: {
      readonly skipFirstLeading?: boolean;
      readonly skipLastTrailing?: boolean;
    },
  ): Doc {
    switch (expr.type) {
      case 'literal': {
        const formatted = formatNumberLiteral(
          expr.token.text,
          this.options.thousandsSeparator,
        );
        return this.tokenDoc(expr.token, {
          overrideText: formatted,
          skipLeading: opts?.skipFirstLeading,
          skipTrailing: opts?.skipLastTrailing,
        });
      }
      case 'unary': {
        const needsSpace = this.expressionStartsWithSign(expr.expr);
        return group(
          concat([
            this.tokenDoc(expr.opToken, {
              skipLeading: opts?.skipFirstLeading,
            }),
            needsSpace ? text(' ') : emptyDoc,
            this.formatExpressionDoc(expr.expr, {
              skipLastTrailing: opts?.skipLastTrailing,
            }),
          ]),
        );
      }
      case 'binary': {
        return group(
          concat([
            this.formatExpressionDoc(expr.lhs, {
              skipFirstLeading: opts?.skipFirstLeading,
            }),
            text(' '),
            this.tokenDoc(expr.opToken),
            indent(
              this.options.indentWidth,
              concat([
                line,
                this.formatExpressionDoc(expr.rhs, {
                  skipLastTrailing: opts?.skipLastTrailing,
                }),
              ]),
            ),
          ]),
        );
      }
      case 'paren': {
        return group(
          concat([
            this.tokenDoc(expr.openParen, {
              skipLeading: opts?.skipFirstLeading,
            }),
            indent(
              this.options.indentWidth,
              concat([softline, this.formatExpressionDoc(expr.expr)]),
            ),
            softline,
            this.tokenDoc(expr.closeParen, {
              skipTrailing: opts?.skipLastTrailing,
            }),
          ]),
        );
      }
    }
  }

  private formatAmountDoc(
    amount: AmountCst,
    opts?: {
      readonly skipFirstLeading?: boolean;
      readonly skipLastTrailing?: boolean;
    },
  ): Doc {
    return group(
      concat([
        this.formatExpressionDoc(amount.amount, {
          skipFirstLeading: opts?.skipFirstLeading,
        }),
        line,
        this.tokenDoc(amount.currencyToken, {
          skipTrailing: opts?.skipLastTrailing,
        }),
      ]),
    );
  }

  private formatMetadataValueDoc(value: MetadataValueCst): Doc {
    switch (value.type) {
      case 'string':
      case 'account':
      case 'currency':
        return this.tokenDoc(value.token);
      case 'date':
        return this.formatDateDoc(value.date);
      case 'amount':
        return this.formatAmountDoc(value.amount);
      case 'number':
        return this.formatExpressionDoc(value.expr);
    }
  }

  private formatMetadataEntries(
    entries: readonly MetadataEntryCst[],
    indentLevels: number,
  ): string[] {
    const padSpace = this.options.indentWidth * indentLevels;
    const lines: string[] = [];

    for (const entry of entries) {
      lines.push(
        ...this.formatLeadingBlockLines(
          entry.keyToken.leadingTrivia,
          indentLevels,
        ),
      );
      const entryDoc = indent(
        padSpace,
        concat([
          text(this.indentStr(indentLevels)),
          group(
            concat([
              this.tokenDoc(entry.keyToken, { skipLeading: true }),
              this.tokenDoc(entry.colonToken),
              line,
              this.formatMetadataValueDoc(entry.value),
            ]),
          ),
        ]),
      );
      lines.push(printDoc(entryDoc, this.options.printWidth));
    }

    return lines;
  }

  private formatConditionLiteralDoc(lit: ConditionLiteralCst): Doc {
    switch (lit.type) {
      case 'identifier':
      case 'string':
      case 'account':
      case 'currency':
        return this.tokenDoc(lit.token);
      case 'number':
        return this.formatExpressionDoc(lit.expr);
      case 'amount':
        return this.formatAmountDoc(lit.amount);
      case 'date':
        return this.formatDateDoc(lit.date);
      case 'duration': {
        const formattedNum = formatNumberLiteral(
          lit.valueToken.text,
          this.options.thousandsSeparator,
        );
        return concat([
          this.tokenDoc(lit.valueToken, { overrideText: formattedNum }),
          this.tokenDoc(lit.unitToken),
        ]);
      }
    }
  }

  private formatConditionDoc(cond: ConditionExpressionCst): Doc {
    switch (cond.type) {
      case 'comparison': {
        const opDoc = joinDocs(
          text(' '),
          cond.operator.tokens.map(t => this.tokenDoc(t)),
        );
        return group(
          concat([
            this.tokenDoc(cond.attributeToken),
            text(' '),
            opDoc,
            indent(
              this.options.indentWidth,
              concat([line, this.formatConditionLiteralDoc(cond.value)]),
            ),
          ]),
        );
      }
      case 'not':
        return group(
          concat([
            this.tokenDoc(cond.notToken),
            text(' '),
            this.formatConditionDoc(cond.expr),
          ]),
        );
      case 'and':
      case 'or': {
        const chain: {
          readonly opToken: RichToken | null;
          readonly expr: ConditionExpressionCst;
        }[] = [];
        const collect = (node: ConditionExpressionCst) => {
          if (node.type === cond.type) {
            collect(node.lhs);
            chain.push({ opToken: node.opToken, expr: node.rhs });
          } else {
            chain.push({ opToken: null, expr: node });
          }
        };
        collect(cond);

        const parts: Doc[] = [this.formatConditionDoc(chain[0].expr)];
        for (let i = 1; i < chain.length; i++) {
          parts.push(
            line,
            this.tokenDoc(chain[i].opToken!),
            text(' '),
            this.formatConditionDoc(chain[i].expr),
          );
        }
        return group(concat(parts));
      }
      case 'paren':
        return group(
          concat([
            this.tokenDoc(cond.openParen),
            indent(
              this.options.indentWidth,
              concat([softline, this.formatConditionDoc(cond.expr)]),
            ),
            softline,
            this.tokenDoc(cond.closeParen),
          ]),
        );
    }
  }

  private formatOutcomeDoc(
    outcome: AccountChoiceOutcomeCst | AccountChoiceOtherwiseOutcomeCst,
  ): Doc {
    switch (outcome.type) {
      case 'account':
        return this.tokenDoc(outcome.accountToken);
      case 'break':
        return this.tokenDoc(outcome.breakToken);
      case 'fail':
        return outcome.messageToken === null
          ? this.tokenDoc(outcome.failToken)
          : group(
              concat([
                this.tokenDoc(outcome.failToken),
                line,
                this.tokenDoc(outcome.messageToken),
              ]),
            );
    }
  }

  private formatRuleClauseDoc(
    clause: RuleClauseCst,
    isLast: boolean,
    commaPolicy: 'always' | 'never' | 'if-break',
  ): Doc {
    const firstTok =
      clause.type === 'when' ? clause.whenToken : clause.otherwiseToken;

    const leadingParts: Doc[] = [];
    for (const item of firstTok.leadingTrivia) {
      if (item.kind === 'blank-lines') {
        leadingParts.push(hardline);
      } else {
        leadingParts.push(text(normalizeCommentText(item.text)), hardline);
      }
    }

    const coreClause =
      clause.type === 'when'
        ? group(
            concat([
              group(
                concat([
                  this.tokenDoc(clause.whenToken, { skipLeading: true }),
                  indent(
                    this.options.indentWidth,
                    concat([line, this.formatConditionDoc(clause.condition)]),
                  ),
                  this.tokenDoc(clause.colonToken),
                ]),
              ),
              indent(
                this.options.indentWidth,
                concat([line, this.formatOutcomeDoc(clause.outcome)]),
              ),
            ]),
          )
        : group(
            concat([
              this.tokenDoc(clause.otherwiseToken, { skipLeading: true }),
              this.tokenDoc(clause.colonToken),
              indent(
                this.options.indentWidth,
                concat([line, this.formatOutcomeDoc(clause.outcome)]),
              ),
            ]),
          );

    // Preserve any comments attached to an existing commaToken even if the comma itself is omitted.
    const commaExtraTrivia: Doc[] = [];
    if (clause.commaToken !== null) {
      if (clause.commaToken.leadingTrivia.length > 0) {
        commaExtraTrivia.push(
          this.emitInteriorLeadingTrivia(clause.commaToken.leadingTrivia),
        );
      }
      if (clause.commaToken.trailingComment !== null) {
        commaExtraTrivia.push(
          lineSuffix(
            `  ${normalizeCommentText(clause.commaToken.trailingComment.text)}`,
          ),
        );
      }
    }

    let commaDoc: Doc;
    if (!isLast) {
      commaDoc = text(',');
    } else if (commaPolicy === 'always') {
      commaDoc = text(',');
    } else if (commaPolicy === 'never') {
      commaDoc = emptyDoc;
    } else {
      commaDoc = ifBreak(text(','), emptyDoc);
    }

    return concat([...leadingParts, coreClause, commaDoc, ...commaExtraTrivia]);
  }

  private formatRuleBlockDoc(
    block: RuleBlockCst,
    allowSingleLine: boolean,
    skipCloseTrailing = false,
  ): Doc {
    const firstClauseTok =
      block.clauses[0].type === 'when'
        ? block.clauses[0].whenToken
        : block.clauses[0].otherwiseToken;

    const forceMultiLine =
      !allowSingleLine ||
      block.clauses.length > 1 ||
      firstClauseTok.hasLeadingNewline ||
      ruleBlockHasComments(block);

    const lastCommaPolicy: 'always' | 'never' | 'if-break' =
      this.options.trailingComma === 'always'
        ? 'always'
        : this.options.trailingComma === 'never'
          ? 'never'
          : 'if-break';

    const clauseDocs = block.clauses.map((clause, idx) =>
      this.formatRuleClauseDoc(
        clause,
        idx === block.clauses.length - 1,
        lastCommaPolicy,
      ),
    );

    const closeLeading =
      block.closeBrace.leadingTrivia.length > 0
        ? concat([
            hardline,
            joinDocs(
              hardline,
              block.closeBrace.leadingTrivia.map(item =>
                item.kind === 'blank-lines'
                  ? emptyDoc
                  : text(normalizeCommentText(item.text)),
              ),
            ),
          ])
        : emptyDoc;

    return group(
      concat([
        this.tokenDoc(block.openBrace),
        indent(
          this.options.indentWidth,
          concat([line, joinDocs(line, clauseDocs), closeLeading]),
        ),
        line,
        this.tokenDoc(block.closeBrace, {
          skipLeading: true,
          skipTrailing: skipCloseTrailing,
        }),
      ]),
      forceMultiLine,
    );
  }

  private formatCostItemDoc(item: CostItemCst, isLast: boolean): Doc {
    let valDoc: Doc;
    switch (item.value.kind) {
      case 'amount':
        valDoc = this.formatAmountDoc(item.value.amount);
        break;
      case 'currency':
      case 'tag':
        valDoc = this.tokenDoc(item.value.token);
        break;
      case 'date':
        valDoc = this.formatDateDoc(item.value.date);
        break;
    }

    if (isLast || item.commaToken === null) {
      return valDoc;
    }

    return concat([valDoc, this.tokenDoc(item.commaToken)]);
  }

  private formatCostSpecDoc(
    costSpec: CostSpecCst,
    skipCloseTrailing = false,
  ): Doc {
    if (
      costSpec.items.length === 0 &&
      !hasAnyTrivia(costSpec.openToken) &&
      costSpec.closeToken.leadingTrivia.length === 0
    ) {
      return concat([
        this.tokenDoc(costSpec.openToken),
        this.tokenDoc(costSpec.closeToken, { skipTrailing: skipCloseTrailing }),
      ]);
    }

    const itemDocs = costSpec.items.map((item, idx) =>
      this.formatCostItemDoc(item, idx === costSpec.items.length - 1),
    );

    const closeLeading =
      costSpec.closeToken.leadingTrivia.length > 0
        ? concat([
            hardline,
            joinDocs(
              hardline,
              costSpec.closeToken.leadingTrivia.map(item =>
                item.kind === 'blank-lines'
                  ? emptyDoc
                  : text(normalizeCommentText(item.text)),
              ),
            ),
          ])
        : emptyDoc;

    return group(
      concat([
        this.tokenDoc(costSpec.openToken),
        indent(
          this.options.indentWidth,
          concat([
            itemDocs.length > 0
              ? concat([line, joinDocs(line, itemDocs)])
              : emptyDoc,
            closeLeading,
          ]),
        ),
        line,
        this.tokenDoc(costSpec.closeToken, {
          skipLeading: true,
          skipTrailing: skipCloseTrailing,
        }),
      ]),
    );
  }

  private formatPriceSpecDoc(
    priceSpec: PriceSpecCst,
    skipLastTrailing = false,
  ): Doc {
    return group(
      concat([
        this.tokenDoc(priceSpec.opToken),
        line,
        this.formatAmountDoc(priceSpec.amount, {
          skipLastTrailing,
        }),
      ]),
    );
  }

  private formatAccountPostingItem(
    posting: AccountPostingCst,
  ): DirectiveBodyItem {
    const firstTok = posting.flagToken ?? posting.accountToken;
    const leadingLines = this.formatLeadingBlockLines(
      firstTok.leadingTrivia,
      1,
    );
    const metaLines = this.formatMetadataEntries(posting.metadata, 2);
    const metadataBlock = metaLines.join('\n');

    // Check if any interior token has unexpected trivia that requires multi-line Doc rendering.
    const flagHasInterior =
      posting.flagToken !== null &&
      (posting.flagToken.trailingComment !== null ||
        hasAnyTrivia(
          posting.accountToken,
          posting.amount === null &&
            posting.costSpec === null &&
            posting.priceSpec === null,
        ));
    const accountHasInterior =
      posting.flagToken === null &&
      posting.accountToken.trailingComment !== null &&
      (posting.amount !== null ||
        posting.costSpec !== null ||
        posting.priceSpec !== null);

    const amountIsLast =
      posting.costSpec === null && posting.priceSpec === null;
    const costIsLast = posting.priceSpec === null;

    const amountInterior =
      posting.amount !== null && amountHasTrivia(posting.amount, amountIsLast);
    const costInterior =
      posting.costSpec !== null &&
      costSpecHasInteriorTrivia(posting.costSpec, costIsLast);
    const priceInterior =
      posting.priceSpec !== null &&
      (hasAnyTrivia(posting.priceSpec.opToken) ||
        amountHasTrivia(posting.priceSpec.amount, true));

    if (
      flagHasInterior ||
      accountHasInterior ||
      amountInterior ||
      costInterior ||
      priceInterior
    ) {
      const parts: Doc[] = [];
      if (posting.flagToken !== null) {
        parts.push(
          this.tokenDoc(posting.flagToken, { skipLeading: true }),
          line,
          this.tokenDoc(posting.accountToken),
        );
      } else {
        parts.push(this.tokenDoc(posting.accountToken, { skipLeading: true }));
      }
      if (posting.amount !== null) {
        parts.push(line, this.formatAmountDoc(posting.amount));
      }
      if (posting.costSpec !== null) {
        parts.push(line, this.formatCostSpecDoc(posting.costSpec));
      }
      if (posting.priceSpec !== null) {
        parts.push(line, this.formatPriceSpecDoc(posting.priceSpec));
      }
      const doc = concat([
        text(this.indentStr(1)),
        indent(this.options.indentWidth, group(concat(parts))),
      ]);
      return {
        kind: 'multiline-row',
        leadingLines,
        rendered: printDoc(doc, this.options.printWidth),
        metadataBlock,
      };
    }

    const leftPrefix =
      posting.flagToken !== null
        ? `${this.indentStr(1)}${posting.flagToken.text} ${posting.accountToken.text}`
        : `${this.indentStr(1)}${posting.accountToken.text}`;

    // Determine the final token on this posting line to extract its trailing comment.
    let finalToken: RichToken = posting.accountToken;
    if (posting.priceSpec !== null) {
      finalToken = posting.priceSpec.amount.currencyToken;
    } else if (posting.costSpec !== null) {
      finalToken = posting.costSpec.closeToken;
    } else if (posting.amount !== null) {
      finalToken = posting.amount.currencyToken;
    }
    const trailingComment =
      finalToken.trailingComment !== null
        ? normalizeCommentText(finalToken.trailingComment.text)
        : null;

    const suffixParts: Doc[] = [];
    if (posting.costSpec !== null) {
      suffixParts.push(this.formatCostSpecDoc(posting.costSpec, costIsLast));
    }
    if (posting.priceSpec !== null) {
      if (suffixParts.length > 0) {
        suffixParts.push(text(' '));
      }
      suffixParts.push(this.formatPriceSpecDoc(posting.priceSpec, true));
    }
    const suffixRendered =
      suffixParts.length > 0
        ? printDoc(concat(suffixParts), this.options.printWidth)
        : '';

    if (posting.amount === null || suffixRendered.includes('\n')) {
      const code =
        posting.amount === null
          ? suffixRendered.length > 0
            ? `${leftPrefix} ${suffixRendered}`
            : leftPrefix
          : `${leftPrefix}${' '.repeat(this.options.minGapSpaces)}${printDoc(this.formatAmountDoc(posting.amount, { skipLastTrailing: amountIsLast }), this.options.printWidth)}${suffixRendered.length > 0 ? ` ${suffixRendered}` : ''}`;

      if (code.includes('\n')) {
        const fullRendered =
          trailingComment !== null ? `${code}  ${trailingComment}` : code;
        return {
          kind: 'multiline-row',
          leadingLines,
          rendered: fullRendered,
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

    const formattedExpr = printDoc(
      this.formatExpressionDoc(posting.amount.amount),
      Number.MAX_SAFE_INTEGER,
    );
    const { intPart, fracPart } = splitDecimalNumberParts(formattedExpr);

    return {
      kind: 'amount-row',
      leadingLines,
      left: leftPrefix,
      intPart,
      fracPart,
      currency: posting.amount.currencyToken.text,
      suffix: suffixRendered,
      trailingComment,
      metadataBlock,
    };
  }

  private formatAccountChoicePostingItem(
    posting: AccountChoicePostingCst,
  ): DirectiveBodyItem {
    const firstTok = posting.flagToken ?? posting.chooseToken;
    const leadingLines = this.formatLeadingBlockLines(
      firstTok.leadingTrivia,
      1,
    );
    const metaLines = this.formatMetadataEntries(posting.metadata, 2);
    const metadataBlock = metaLines.join('\n');

    const hasPrefixInterior =
      (posting.flagToken !== null &&
        (posting.flagToken.trailingComment !== null ||
          hasAnyTrivia(posting.chooseToken))) ||
      (posting.flagToken === null &&
        posting.chooseToken.trailingComment !== null) ||
      hasAnyTrivia(posting.accountKeywordToken);

    if (
      posting.target.type === 'ref' &&
      !hasPrefixInterior &&
      posting.target.nameToken.leadingTrivia.length === 0
    ) {
      const flagPrefix =
        posting.flagToken !== null ? `${posting.flagToken.text} ` : '';
      const code = `${this.indentStr(1)}${flagPrefix}choose account ${posting.target.nameToken.text}`;
      const trailingComment =
        posting.target.nameToken.trailingComment !== null
          ? normalizeCommentText(posting.target.nameToken.trailingComment.text)
          : null;
      return {
        kind: 'plain-row',
        leadingLines,
        code,
        trailingComment,
        metadataBlock,
      };
    }

    const prefixParts: Doc[] = [];
    if (posting.flagToken !== null) {
      prefixParts.push(
        this.tokenDoc(posting.flagToken, { skipLeading: true }),
        line,
        this.tokenDoc(posting.chooseToken),
      );
    } else {
      prefixParts.push(
        this.tokenDoc(posting.chooseToken, { skipLeading: true }),
      );
    }
    prefixParts.push(line, this.tokenDoc(posting.accountKeywordToken));

    const skipTargetTrailing =
      !hasPrefixInterior &&
      posting.target.type === 'inline' &&
      posting.target.block.closeBrace.trailingComment !== null;

    const targetDoc =
      posting.target.type === 'ref'
        ? this.tokenDoc(posting.target.nameToken)
        : this.formatRuleBlockDoc(
            posting.target.block,
            true,
            skipTargetTrailing,
          );

    const fullDoc = concat([
      text(this.indentStr(1)),
      indent(
        this.options.indentWidth,
        concat([group(concat(prefixParts)), text(' '), targetDoc]),
      ),
    ]);
    const rendered = printDoc(fullDoc, this.options.printWidth);

    const trailingComment =
      skipTargetTrailing &&
      posting.target.type === 'inline' &&
      posting.target.block.closeBrace.trailingComment !== null
        ? normalizeCommentText(
            posting.target.block.closeBrace.trailingComment.text,
          )
        : null;

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

  private formatPostingItem(posting: PostingCst): DirectiveBodyItem {
    return posting.type === 'account-posting'
      ? this.formatAccountPostingItem(posting)
      : this.formatAccountChoicePostingItem(posting);
  }

  private formatBalanceEntryItem(entry: BalanceEntryCst): DirectiveBodyItem {
    const leadingLines = this.formatLeadingBlockLines(
      entry.accountToken.leadingTrivia,
      1,
    );
    const approxIsPresent = entry.approx !== null;

    const accountInterior = entry.accountToken.trailingComment !== null;
    const amountInterior = amountHasTrivia(entry.amount, !approxIsPresent);
    const approxInterior =
      entry.approx !== null &&
      (hasAnyTrivia(entry.approx.tildeToken) ||
        expressionHasTrivia(entry.approx.tolerance, true));

    if (accountInterior || amountInterior || approxInterior) {
      const parts: Doc[] = [
        this.tokenDoc(entry.accountToken, { skipLeading: true }),
        line,
        this.formatAmountDoc(entry.amount),
      ];
      if (entry.approx !== null) {
        parts.push(
          line,
          this.tokenDoc(entry.approx.tildeToken),
          line,
          this.formatExpressionDoc(entry.approx.tolerance),
        );
      }
      const doc = concat([
        text(this.indentStr(1)),
        indent(this.options.indentWidth, group(concat(parts))),
      ]);
      return {
        kind: 'multiline-row',
        leadingLines,
        rendered: printDoc(doc, this.options.printWidth),
        metadataBlock: '',
      };
    }

    const finalToken =
      entry.approx !== null
        ? rightmostExpressionToken(entry.approx.tolerance)
        : entry.amount.currencyToken;

    const trailingComment =
      finalToken.trailingComment !== null
        ? normalizeCommentText(finalToken.trailingComment.text)
        : null;

    const suffix =
      entry.approx !== null
        ? `~ ${printDoc(this.formatExpressionDoc(entry.approx.tolerance, { skipLastTrailing: true }), Number.MAX_SAFE_INTEGER)}`
        : '';

    const formattedExpr = printDoc(
      this.formatExpressionDoc(entry.amount.amount),
      Number.MAX_SAFE_INTEGER,
    );
    const { intPart, fracPart } = splitDecimalNumberParts(formattedExpr);

    return {
      kind: 'amount-row',
      leadingLines,
      left: `${this.indentStr(1)}${entry.accountToken.text}`,
      intPart,
      fracPart,
      currency: entry.amount.currencyToken.text,
      suffix,
      trailingComment,
      metadataBlock: '',
    };
  }

  private firstDirectiveToken(directive: DirectiveCst): RichToken {
    switch (directive.type) {
      case 'account-rule':
      case 'load':
      case 'option':
        return directive.keywordToken;
      case 'balance':
      case 'close':
      case 'currency':
      case 'commodity':
      case 'open':
      case 'price':
      case 'transaction':
        return directive.date.dateToken;
    }
  }

  formatLeadingTopLevelPrefix(
    trivia: readonly TriviaItem[],
    isFirstSegment: boolean,
    prevSegmentWasMultiline: boolean,
    currentSegmentIsMultiline = false,
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

    return out.join('');
  }

  private formatTransactionDirective(
    directive: TransactionDirectiveCst,
    triviaOverride: readonly TriviaItem[],
    isFirstSegment: boolean,
    prevWasMultiline: boolean,
  ): AlignableDirectiveBlock {
    let flagText = directive.flagToken.text;
    if (flagText !== '!') {
      if (this.options.transactionFlagStyle === 'star') {
        flagText = '*';
      } else if (this.options.transactionFlagStyle === 'txn') {
        flagText = 'txn';
      }
    }

    const headerDoc = group(
      concat([
        this.formatDateDoc(directive.date, true),
        indent(
          this.options.indentWidth,
          concat([
            line,
            this.tokenDoc(directive.flagToken, { overrideText: flagText }),
            line,
            this.tokenDoc(directive.descriptionToken),
          ]),
        ),
      ]),
    );
    const headerRendered = printDoc(headerDoc, this.options.printWidth);
    const metaLines = this.formatMetadataEntries(directive.metadata, 1);
    const headerAndMetaLines = [headerRendered, ...metaLines];
    const items = directive.postings.map(p => this.formatPostingItem(p));

    const isMultiline =
      headerRendered.includes('\n') || metaLines.length > 0 || items.length > 0;
    const prefixText = this.formatLeadingTopLevelPrefix(
      triviaOverride,
      isFirstSegment,
      prevWasMultiline,
      isMultiline,
    );

    return {
      kind: 'aligned-directive',
      prefixText,
      headerAndMetaLines,
      items,
      isMultiline,
    };
  }

  private formatBalanceDirective(
    directive: BalanceDirectiveCst,
    triviaOverride: readonly TriviaItem[],
    isFirstSegment: boolean,
    prevWasMultiline: boolean,
  ): AlignableDirectiveBlock {
    const headerDoc = group(
      concat([
        this.formatDateDoc(directive.date, true),
        indent(
          this.options.indentWidth,
          concat([line, this.tokenDoc(directive.keywordToken)]),
        ),
      ]),
    );
    const headerRendered = printDoc(headerDoc, this.options.printWidth);
    const metaLines = this.formatMetadataEntries(directive.metadata, 1);
    const headerAndMetaLines = [headerRendered, ...metaLines];
    const items = directive.balances.map(b => this.formatBalanceEntryItem(b));

    const isMultiline =
      headerRendered.includes('\n') || metaLines.length > 0 || items.length > 0;
    const prefixText = this.formatLeadingTopLevelPrefix(
      triviaOverride,
      isFirstSegment,
      prevWasMultiline,
      isMultiline,
    );

    return {
      kind: 'aligned-directive',
      prefixText,
      headerAndMetaLines,
      items,
      isMultiline,
    };
  }

  formatDirective(
    directive: DirectiveCst,
    triviaOverride: readonly TriviaItem[],
    isFirstSegment: boolean,
    prevWasMultiline: boolean,
  ): TopLevelFormattedSegment {
    if (directive.type === 'transaction') {
      return this.formatTransactionDirective(
        directive,
        triviaOverride,
        isFirstSegment,
        prevWasMultiline,
      );
    }
    if (directive.type === 'balance') {
      return this.formatBalanceDirective(
        directive,
        triviaOverride,
        isFirstSegment,
        prevWasMultiline,
      );
    }

    let headerDoc: Doc;
    switch (directive.type) {
      case 'load':
        headerDoc = group(
          concat([
            this.tokenDoc(directive.keywordToken, { skipLeading: true }),
            indent(
              this.options.indentWidth,
              concat([line, this.tokenDoc(directive.pathToken)]),
            ),
          ]),
        );
        break;
      case 'option':
        headerDoc = group(
          concat([
            this.tokenDoc(directive.keywordToken, { skipLeading: true }),
            indent(
              this.options.indentWidth,
              concat([
                line,
                this.tokenDoc(directive.nameToken),
                line,
                this.tokenDoc(directive.valueToken),
              ]),
            ),
          ]),
        );
        break;
      case 'close':
        headerDoc = group(
          concat([
            this.formatDateDoc(directive.date, true),
            indent(
              this.options.indentWidth,
              concat([
                line,
                this.tokenDoc(directive.keywordToken),
                line,
                this.tokenDoc(directive.accountToken),
              ]),
            ),
          ]),
        );
        break;
      case 'currency':
      case 'commodity': {
        const kwText =
          this.options.currencyKeywordStyle === 'preserve'
            ? directive.keywordToken.text
            : this.options.currencyKeywordStyle;
        headerDoc = group(
          concat([
            this.formatDateDoc(directive.date, true),
            indent(
              this.options.indentWidth,
              concat([
                line,
                this.tokenDoc(directive.keywordToken, { overrideText: kwText }),
                line,
                this.tokenDoc(directive.currencyToken),
              ]),
            ),
          ]),
        );
        break;
      }
      case 'open':
        headerDoc = group(
          concat([
            this.formatDateDoc(directive.date, true),
            indent(
              this.options.indentWidth,
              concat([
                line,
                this.tokenDoc(directive.keywordToken),
                line,
                this.tokenDoc(directive.accountToken),
                ...directive.currencyTokens.flatMap(tok => [
                  line,
                  this.tokenDoc(tok),
                ]),
              ]),
            ),
          ]),
        );
        break;
      case 'price':
        headerDoc = group(
          concat([
            this.formatDateDoc(directive.date, true),
            indent(
              this.options.indentWidth,
              concat([
                line,
                this.tokenDoc(directive.keywordToken),
                line,
                this.tokenDoc(directive.currencyToken),
                line,
                this.formatAmountDoc(directive.price),
              ]),
            ),
          ]),
        );
        break;
      case 'account-rule':
        headerDoc = concat([
          group(
            concat([
              this.tokenDoc(directive.keywordToken, { skipLeading: true }),
              line,
              this.tokenDoc(directive.nameToken),
            ]),
          ),
          text(' '),
          this.formatRuleBlockDoc(directive.block, false),
        ]);
        break;
    }

    const headerRendered = printDoc(headerDoc, this.options.printWidth);
    const metaLines = this.formatMetadataEntries(directive.metadata, 1);
    const bodyLines = [headerRendered, ...metaLines].join('\n');
    const isMultiline =
      directive.type === 'account-rule' ||
      headerRendered.includes('\n') ||
      metaLines.length > 0;
    const prefixText = this.formatLeadingTopLevelPrefix(
      triviaOverride,
      isFirstSegment,
      prevWasMultiline,
      isMultiline,
    );

    return {
      kind: 'static-chunk',
      text: `${prefixText}${bodyLines}`,
      isMultiline,
    };
  }

  getFirstToken(directive: DirectiveCst): RichToken {
    return this.firstDirectiveToken(directive);
  }
}

function buildTopLevelSegments(
  source: string,
  directives: readonly DirectiveCst[],
  eofTrivia: readonly TriviaItem[],
  builder: FormatterBuilder,
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
      .replace(/[ \t\r\n]+$/, '');
    const isMulti = rawSlice.includes('\n');
    const prefixText = builder.formatLeadingTopLevelPrefix(
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
    const firstTok = builder.getFirstToken(directive);
    const trivia = firstTok.leadingTrivia;
    let remainingStartIdx = 0;

    for (let i = 0; i < trivia.length; i++) {
      const item = trivia[i];
      if (pragmaOffStartOffset === null && isFormatOffTrivia(item)) {
        pragmaBeforeOffTrivia = trivia.slice(remainingStartIdx, i);
        pragmaIsFirst = isFirst;
        pragmaPrevWasMultiline = prevWasMultiline;
        pragmaOffStartOffset = item.span.start.offset;
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
    const seg = builder.formatDirective(
      directive,
      activeTrivia,
      isFirst,
      prevWasMultiline,
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
      pragmaOffStartOffset = item.span.start.offset;
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
      const prefix = builder.formatLeadingTopLevelPrefix(
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

/**
 * Formats Ledger source text according to `options`.
 *
 * Re-parses the formatted output to verify that semantic `LedgerSpec` meaning
 * and all `;` comments are preserved before returning.
 *
 * @param contents Raw Ledger source text to format.
 * @param options Optional formatting configuration overrides.
 * @returns Either the formatted Ledger text, or a `FormatError` on failure.
 */
export function format(
  contents: string,
  options?: Partial<FormatOptions>,
): E.Either<FormatError, string> {
  const resolvedOpts =
    options === undefined
      ? E.right(DEFAULT_FORMAT_OPTIONS)
      : resolveFormatOptions(options);
  if (E.isLeft(resolvedOpts)) {
    return resolvedOpts;
  }
  const opts = resolvedOpts.right;

  const parsed = parseSyntax(contents);
  if (E.isLeft(parsed)) {
    return E.left(
      new FormatError(parsed.left.message, parsed.left.srcPos, {
        cause: parsed.left,
      }),
    );
  }

  const tree = parsed.right;
  if (tree.directives.length === 0 && tree.eofTrivia.length === 0) {
    return E.right('');
  }

  const builder = new FormatterBuilder(opts);
  const segments = buildTopLevelSegments(
    contents,
    tree.directives,
    tree.eofTrivia,
    builder,
  );

  if (segments.length === 0) {
    return E.right('');
  }

  const body = renderSegments(segments, opts);
  const formatted = body.length === 0 ? '' : `${body}\n`;

  const verified = verifyFormattedOutput(tree, formatted, opts);
  if (E.isLeft(verified)) {
    return verified;
  }

  return E.right(formatted);
}
