import { AmountCst } from '../../syntax/cst/amount.js';
import { DateCst } from '../../syntax/cst/date.js';
import { ExpressionCst } from '../../syntax/cst/expression.js';
import {
  MetadataEntryCst,
  MetadataValueCst,
} from '../../syntax/cst/metadata.js';
import { FormatOptions } from '../options.js';
import { rightmostMetadataValueToken } from './cst.js';
import {
  concat,
  Doc,
  emptyDoc,
  group,
  indent,
  line,
  printDoc,
  softline,
  text,
} from './doc.js';
import { formatNumberLiteral } from './number.js';
import {
  collectInteriorComments,
  formatLeadingBlockLines,
  indentStr,
  shiftComments,
  trailingCommentText,
} from './trivia.js';

function expressionStartsWithSign(root: ExpressionCst): boolean {
  let cur: ExpressionCst = root;
  while (cur.type === 'binary') {
    cur = cur.lhs;
  }
  switch (cur.type) {
    case 'literal':
      return cur.token.text.startsWith('-');
    case 'unary':
      return cur.op === '-' || cur.op === '+';
    case 'paren':
      return false;
  }
}

export function formatDateText(date: DateCst): string {
  let out = date.dateToken.text;
  if (date.timeToken !== null) {
    out += ` ${date.timeToken.text}`;
  }
  if (date.timezoneToken !== null) {
    out += ` ${date.timezoneToken.text}`;
  }
  return out;
}

function binaryPrecedence(op: '+' | '-' | '*' | '/'): 1 | 2 {
  return op === '+' || op === '-' ? 1 : 2;
}

export function formatExpressionDoc(
  expr: ExpressionCst,
  options: FormatOptions,
): Doc {
  switch (expr.type) {
    case 'literal':
      return text(
        formatNumberLiteral(expr.token.text, options.thousandsSeparator),
      );
    case 'unary':
      return concat([
        text(expr.op),
        expressionStartsWithSign(expr.expr) ? text(' ') : emptyDoc,
        formatExpressionDoc(expr.expr, options),
      ]);
    case 'binary': {
      const prec = binaryPrecedence(expr.op);
      const chain: {
        readonly op: '+' | '-' | '*' | '/' | null;
        readonly expr: ExpressionCst;
      }[] = [];
      let cur: ExpressionCst = expr;
      while (cur.type === 'binary' && binaryPrecedence(cur.op) === prec) {
        chain.push({ op: cur.op, expr: cur.rhs });
        cur = cur.lhs;
      }
      chain.push({ op: null, expr: cur });
      chain.reverse();

      const firstDoc = formatExpressionDoc(chain[0].expr, options);
      const restParts: Doc[] = [];
      for (let i = 1; i < chain.length; i++) {
        restParts.push(
          text(` ${chain[i].op!}`),
          line,
          formatExpressionDoc(chain[i].expr, options),
        );
      }
      return group(
        concat([firstDoc, indent(options.indentWidth, concat(restParts))]),
      );
    }
    case 'paren':
      return group(
        concat([
          text('('),
          indent(
            options.indentWidth,
            concat([softline, formatExpressionDoc(expr.expr, options)]),
          ),
          softline,
          text(')'),
        ]),
      );
  }
}

export function formatAmountDoc(
  amount: AmountCst,
  options: FormatOptions,
): Doc {
  return concat([
    formatExpressionDoc(amount.amount, options),
    text(` ${amount.currencyToken.text}`),
  ]);
}

export function formatMetadataValueDoc(
  value: MetadataValueCst,
  options: FormatOptions,
): Doc {
  switch (value.type) {
    case 'string':
    case 'account':
    case 'currency':
      return text(value.token.text);
    case 'date':
      return text(formatDateText(value.date));
    case 'amount':
      return formatAmountDoc(value.amount, options);
    case 'number':
      return formatExpressionDoc(value.expr, options);
  }
}

export function formatMetadataEntries(
  entries: readonly MetadataEntryCst[],
  indentLevels: number,
  options: FormatOptions,
): string[] {
  const padSpace = options.indentWidth * indentLevels;
  const lines: string[] = [];

  for (const entry of entries) {
    const lastTok = rightmostMetadataValueToken(entry.value);
    const shifted = shiftComments(
      collectInteriorComments(entry.keyToken, lastTok),
      trailingCommentText(lastTok),
    );
    lines.push(
      ...formatLeadingBlockLines(
        entry.keyToken.leadingTrivia,
        options.indentWidth,
        indentLevels,
        shifted.hoisted,
      ),
    );

    const valSep =
      entry.value.type === 'number' || entry.value.type === 'amount'
        ? line
        : text(' ');
    const entryDoc = indent(
      padSpace,
      concat([
        text(indentStr(options.indentWidth, indentLevels)),
        group(
          concat([
            text(`${entry.keyToken.text}:`),
            indent(
              options.indentWidth,
              concat([valSep, formatMetadataValueDoc(entry.value, options)]),
            ),
          ]),
        ),
      ]),
    );
    const rendered = printDoc(entryDoc, options.printWidth);
    lines.push(
      shifted.trailing !== null ? `${rendered}  ${shifted.trailing}` : rendered,
    );
  }

  return lines;
}
