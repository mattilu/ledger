import {
  ConditionExpressionCst,
  ConditionLiteralCst,
} from '../../syntax/cst/condition.js';
import {
  AccountChoiceOtherwiseOutcomeCst,
  AccountChoiceOutcomeCst,
  RuleBlockCst,
  RuleClauseCst,
} from '../../syntax/cst/directives/account-rule.js';
import { RichToken } from '../../syntax/token.js';
import { FormatOptions } from '../options.js';
import { normalizeCommentText } from './comment.js';
import {
  leftmostConditionToken,
  rightmostConditionToken,
  rightmostOutcomeToken,
} from './cst.js';
import {
  concat,
  Doc,
  emptyDoc,
  group,
  hardline,
  ifBreak,
  indent,
  joinDocs,
  line,
  softline,
  text,
} from './doc.js';
import {
  formatAmountDoc,
  formatDateText,
  formatExpressionDoc,
} from './expr.js';
import { formatNumberLiteral } from './number.js';
import {
  collectInteriorComments,
  collectLeadingComments,
  formatClosingLeadingTrivia,
  shiftComments,
  trailingCommentText,
} from './trivia.js';

function formatConditionLiteralDoc(
  lit: ConditionLiteralCst,
  options: FormatOptions,
): Doc {
  switch (lit.type) {
    case 'identifier':
    case 'string':
    case 'account':
    case 'currency':
      return text(lit.token.text);
    case 'number':
      return formatExpressionDoc(lit.expr, options);
    case 'amount':
      return formatAmountDoc(lit.amount, options);
    case 'date':
      return text(formatDateText(lit.date));
    case 'duration':
      return text(
        `${formatNumberLiteral(lit.valueToken.text, options.thousandsSeparator)}${lit.unitToken.text}`,
      );
  }
}

function formatConditionPureDoc(
  cond: ConditionExpressionCst,
  options: FormatOptions,
): Doc {
  switch (cond.type) {
    case 'comparison':
      return group(
        concat([
          text(cond.attributeToken.text),
          indent(
            options.indentWidth,
            concat([
              text(` ${cond.operator.operator}`),
              line,
              formatConditionLiteralDoc(cond.value, options),
            ]),
          ),
        ]),
      );
    case 'not':
      return concat([text('not '), formatConditionPureDoc(cond.expr, options)]);
    case 'and':
    case 'or': {
      const chain: {
        readonly op: 'and' | 'or' | null;
        readonly expr: ConditionExpressionCst;
      }[] = [];
      let cur: ConditionExpressionCst = cond;
      while (cur.type === cond.type) {
        chain.push({ op: cur.type, expr: cur.rhs });
        cur = cur.lhs;
      }
      chain.push({ op: null, expr: cur });
      chain.reverse();

      const parts: Doc[] = [formatConditionPureDoc(chain[0].expr, options)];
      for (let i = 1; i < chain.length; i++) {
        parts.push(
          line,
          text(`${chain[i].op!} `),
          formatConditionPureDoc(chain[i].expr, options),
        );
      }
      return group(concat(parts));
    }
    case 'paren':
      return group(
        concat([
          text('('),
          indent(
            options.indentWidth,
            concat([softline, formatConditionPureDoc(cond.expr, options)]),
          ),
          softline,
          text(')'),
        ]),
      );
  }
}

function conditionContainsAndOr(cond: ConditionExpressionCst): boolean {
  switch (cond.type) {
    case 'comparison':
      return false;
    case 'and':
    case 'or':
      return true;
    case 'not':
    case 'paren':
      return conditionContainsAndOr(cond.expr);
  }
}

function conditionHasAndOrComments(cond: ConditionExpressionCst): boolean {
  return (
    conditionContainsAndOr(cond) &&
    collectInteriorComments(
      leftmostConditionToken(cond),
      rightmostConditionToken(cond),
    ).length > 0
  );
}

interface FormattedCondition {
  readonly doc: Doc;
  readonly hoisted: readonly string[];
  readonly hasAndOrComments: boolean;
}

/**
 * Formats a `when` condition, keeping comments at `and` / `or` operand
 * boundaries as canonical slots while shifting any mid-comparison comments
 * into the enclosing operand or clause slot.
 */
function formatCondition(
  cond: ConditionExpressionCst,
  options: FormatOptions,
): FormattedCondition {
  if (!conditionHasAndOrComments(cond)) {
    return {
      doc: formatConditionPureDoc(cond, options),
      hoisted: [],
      hasAndOrComments: false,
    };
  }

  switch (cond.type) {
    case 'and':
    case 'or': {
      const chain: {
        readonly opToken: RichToken | null;
        readonly expr: ConditionExpressionCst;
      }[] = [];
      let cur: ConditionExpressionCst = cond;
      while (cur.type === cond.type) {
        chain.push({ opToken: cur.opToken, expr: cur.rhs });
        cur = cur.lhs;
      }
      chain.push({ opToken: null, expr: cur });
      chain.reverse();

      const hoisted: string[] = [];
      const parts: Doc[] = [];

      for (let i = 0; i < chain.length; i++) {
        const { opToken, expr } = chain[i];
        const isLast = i === chain.length - 1;
        const exprFirst = leftmostConditionToken(expr);
        const exprLast = rightmostConditionToken(expr);

        const beforeComments: string[] = [];
        if (opToken !== null) {
          beforeComments.push(
            ...collectLeadingComments(opToken),
            ...collectInteriorComments(opToken, exprFirst),
          );
        }

        let operandDoc: Doc;
        let operandTrailing: string | null = null;
        if (conditionHasAndOrComments(expr)) {
          const sub = formatCondition(expr, options);
          if (i === 0) {
            hoisted.push(...sub.hoisted);
          } else {
            beforeComments.push(...sub.hoisted);
          }
          operandDoc = sub.doc;
          if (!isLast) {
            operandTrailing = trailingCommentText(exprLast);
          }
        } else {
          const inner = collectInteriorComments(exprFirst, exprLast);
          operandDoc = formatConditionPureDoc(expr, options);
          if (!isLast) {
            const shifted = shiftComments(inner, trailingCommentText(exprLast));
            if (i === 0) {
              hoisted.push(...shifted.hoisted);
            } else {
              beforeComments.push(...shifted.hoisted);
            }
            operandTrailing = shifted.trailing;
          } else {
            // Preserve order: interior comments inside the last operand stay
            // immediately before its `and`/`or` operator, leaving
            // `exprLast.trailingComment` to the enclosing scope.
            beforeComments.push(...inner);
          }
        }

        const fullOperandDoc =
          operandTrailing !== null
            ? concat([operandDoc, text(`  ${operandTrailing}`)])
            : operandDoc;

        if (i === 0) {
          parts.push(fullOperandDoc);
        } else {
          for (const c of beforeComments) {
            parts.push(hardline, text(c));
          }
          parts.push(hardline, text(`${opToken!.text} `), fullOperandDoc);
        }
      }

      return {
        doc: group(concat(parts), true),
        hoisted,
        hasAndOrComments: true,
      };
    }
    case 'not': {
      const sub = formatCondition(cond.expr, options);
      const between = collectInteriorComments(
        cond.notToken,
        leftmostConditionToken(cond.expr),
      );
      return {
        doc: concat([text('not '), sub.doc]),
        hoisted: [...between, ...sub.hoisted],
        hasAndOrComments: true,
      };
    }
    case 'paren': {
      const sub = formatCondition(cond.expr, options);
      const openComments = [
        ...collectInteriorComments(
          cond.openParen,
          leftmostConditionToken(cond.expr),
        ),
        ...sub.hoisted,
      ];
      const exprLastTrailing = trailingCommentText(
        rightmostConditionToken(cond.expr),
      );
      const closeLeading = formatClosingLeadingTrivia(
        cond.closeParen.leadingTrivia,
      );

      const innerParts: Doc[] = [hardline];
      for (const c of openComments) {
        innerParts.push(text(c), hardline);
      }
      innerParts.push(sub.doc);
      if (exprLastTrailing !== null) {
        innerParts.push(text(`  ${exprLastTrailing}`));
      }
      innerParts.push(closeLeading);

      return {
        doc: group(
          concat([
            text('('),
            indent(options.indentWidth, concat(innerParts)),
            hardline,
            text(')'),
          ]),
          true,
        ),
        hoisted: [],
        hasAndOrComments: true,
      };
    }
    case 'comparison':
      // Unreachable because `conditionHasAndOrComments` is false for comparisons.
      return {
        doc: formatConditionPureDoc(cond, options),
        hoisted: [],
        hasAndOrComments: false,
      };
  }
}

function formatOutcomeDoc(
  outcome: AccountChoiceOutcomeCst | AccountChoiceOtherwiseOutcomeCst,
): Doc {
  switch (outcome.type) {
    case 'account':
      return text(outcome.accountToken.text);
    case 'break':
      return text(outcome.breakToken.text);
    case 'fail':
      return outcome.messageToken === null
        ? text(outcome.failToken.text)
        : group(
            concat([
              text(outcome.failToken.text),
              line,
              text(outcome.messageToken.text),
            ]),
          );
  }
}

function formatRuleClauseDoc(
  clause: RuleClauseCst,
  isLast: boolean,
  commaPolicy: 'always' | 'never' | 'if-break',
  options: FormatOptions,
): Doc {
  const firstTok =
    clause.type === 'when' ? clause.whenToken : clause.otherwiseToken;
  const lastTok = clause.commaToken ?? rightmostOutcomeToken(clause.outcome);
  const clauseTrailing = trailingCommentText(lastTok);

  const leadingParts: Doc[] = [];
  for (const item of firstTok.leadingTrivia) {
    if (item.kind === 'blank-lines') {
      leadingParts.push(hardline);
    } else {
      leadingParts.push(text(normalizeCommentText(item.text)), hardline);
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

  if (clause.type === 'otherwise') {
    const shifted = shiftComments(
      collectInteriorComments(clause.otherwiseToken, lastTok),
      clauseTrailing,
    );
    for (const c of shifted.hoisted) {
      leadingParts.push(text(c), hardline);
    }
    return concat([
      ...leadingParts,
      group(
        concat([
          text('otherwise:'),
          indent(
            options.indentWidth,
            concat([line, formatOutcomeDoc(clause.outcome)]),
          ),
        ]),
      ),
      commaDoc,
      shifted.trailing !== null ? text(`  ${shifted.trailing}`) : emptyDoc,
    ]);
  }

  const condRes = formatCondition(clause.condition, options);
  if (!condRes.hasAndOrComments) {
    const shifted = shiftComments(
      collectInteriorComments(clause.whenToken, lastTok),
      clauseTrailing,
    );
    for (const c of shifted.hoisted) {
      leadingParts.push(text(c), hardline);
    }
    return concat([
      ...leadingParts,
      group(
        concat([
          group(
            concat([
              text('when'),
              indent(
                options.indentWidth,
                concat([line, condRes.doc, text(':')]),
              ),
            ]),
          ),
          indent(
            options.indentWidth,
            concat([line, formatOutcomeDoc(clause.outcome)]),
          ),
        ]),
      ),
      commaDoc,
      shifted.trailing !== null ? text(`  ${shifted.trailing}`) : emptyDoc,
    ]);
  }

  // Condition has canonical `and`/`or` comments: hoist pre-condition comments
  // above `when`, keep `and`/`or` operand comments inline, and keep any
  // post-condition comments after `:` / at the end of the clause so comment
  // order never crosses the condition.
  const beforeCond = [
    ...collectInteriorComments(
      clause.whenToken,
      leftmostConditionToken(clause.condition),
    ),
    ...condRes.hoisted,
  ];
  for (const c of beforeCond) {
    leadingParts.push(text(c), hardline);
  }

  const afterCond = collectInteriorComments(
    rightmostConditionToken(clause.condition),
    lastTok,
  );
  let colonComments: readonly string[] = [];
  let finalTrailing: string | null = clauseTrailing;
  if (clauseTrailing === null && afterCond.length === 1) {
    finalTrailing = afterCond[0];
  } else {
    colonComments = afterCond;
  }

  const outcomeParts: Doc[] = [];
  for (let i = 1; i < colonComments.length; i++) {
    outcomeParts.push(hardline, text(colonComments[i]));
  }
  outcomeParts.push(
    hardline,
    formatOutcomeDoc(clause.outcome),
    commaDoc,
    finalTrailing !== null ? text(`  ${finalTrailing}`) : emptyDoc,
  );

  return concat([
    ...leadingParts,
    group(
      concat([
        text('when'),
        indent(
          options.indentWidth,
          concat([
            hardline,
            condRes.doc,
            text(':'),
            colonComments.length > 0 ? text(`  ${colonComments[0]}`) : emptyDoc,
          ]),
        ),
        indent(options.indentWidth, concat(outcomeParts)),
      ]),
      true,
    ),
  ]);
}

export function formatRuleBlockDoc(
  block: RuleBlockCst,
  allowSingleLine: boolean,
  options: FormatOptions,
  openBraceTrailingOverride?: string | null,
): Doc {
  const firstClauseTok =
    block.clauses[0].type === 'when'
      ? block.clauses[0].whenToken
      : block.clauses[0].otherwiseToken;

  const openTrailing =
    openBraceTrailingOverride !== undefined
      ? openBraceTrailingOverride
      : trailingCommentText(block.openBrace);
  const blockHasInteriorComments =
    openTrailing !== null ||
    collectInteriorComments(block.openBrace, block.closeBrace).length > 0;

  const forceMultiLine =
    !allowSingleLine ||
    block.clauses.length > 1 ||
    firstClauseTok.hasLeadingNewline ||
    blockHasInteriorComments;

  const lastCommaPolicy: 'always' | 'never' | 'if-break' =
    options.trailingComma === 'always'
      ? 'always'
      : options.trailingComma === 'never'
        ? 'never'
        : 'if-break';

  const clauseDocs = block.clauses.map((clause, idx) =>
    formatRuleClauseDoc(
      clause,
      idx === block.clauses.length - 1,
      lastCommaPolicy,
      options,
    ),
  );

  const closeLeading = formatClosingLeadingTrivia(
    block.closeBrace.leadingTrivia,
  );

  return group(
    concat([
      text(block.openBrace.text),
      openTrailing !== null ? text(`  ${openTrailing}`) : emptyDoc,
      indent(
        options.indentWidth,
        concat([line, joinDocs(line, clauseDocs), closeLeading]),
      ),
      line,
      text(block.closeBrace.text),
    ]),
    forceMultiLine,
  );
}
