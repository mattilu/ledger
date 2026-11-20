import { ExactNumber } from 'exactnumber';
import { either as E } from 'fp-ts';

import { lowerSyntaxTree } from '../../parsing/parser.js';
import { ConditionExpression } from '../../parsing/spec/condition.js';
import { DirectiveSpec } from '../../parsing/spec/directive.js';
import { Expression } from '../../parsing/spec/expression.js';
import { LedgerSpec } from '../../parsing/spec/ledger.js';
import { MetadataSpec } from '../../parsing/spec/metadata.js';
import { SyntaxTree } from '../../syntax/cst/ledger.js';
import { parseSyntax } from '../../syntax/parser.js';
import { RichToken } from '../../syntax/token.js';
import { TriviaItem } from '../../syntax/trivia.js';
import { FormatError } from '../error.js';
import { FormatOptions } from '../options.js';
import { normalizeCommentText } from './comment.js';
import { firstDirectiveToken } from './cst.js';

type CanonicalExpr =
  | { readonly type: 'literal'; readonly value: string }
  | {
      readonly type: 'unary';
      readonly op: '+' | '-';
      readonly expr: CanonicalExpr;
    }
  | {
      readonly type: 'binary';
      readonly op: '+' | '-' | '*' | '/';
      readonly expr1: CanonicalExpr;
      readonly expr2: CanonicalExpr;
    };

type CanonicalCondition =
  | {
      readonly type: 'comparison';
      readonly attribute: string;
      readonly operator: string;
      readonly value: unknown;
    }
  | { readonly type: 'not'; readonly expr: CanonicalCondition }
  | {
      readonly type: 'and' | 'or';
      readonly lhs: CanonicalCondition;
      readonly rhs: CanonicalCondition;
    };

function canonicalizeExpression(expr: Expression): CanonicalExpr {
  switch (expr.type) {
    case 'literal':
      return { type: 'literal', value: expr.value.toString() };
    case 'unary': {
      const inner = canonicalizeExpression(expr.expr);
      if (expr.op === '-' && inner.type === 'literal') {
        return {
          type: 'literal',
          value: ExactNumber(inner.value).neg().toString(),
        };
      }
      return { type: 'unary', op: expr.op, expr: inner };
    }
    case 'binary': {
      const chain: {
        readonly op: '+' | '-' | '*' | '/';
        readonly rhs: Expression;
      }[] = [];
      let cur: Expression = expr;
      while (cur.type === 'binary') {
        chain.push({ op: cur.op, rhs: cur.expr2 });
        cur = cur.expr1;
      }
      let result = canonicalizeExpression(cur);
      for (let i = chain.length - 1; i >= 0; i--) {
        result = {
          type: 'binary',
          op: chain[i].op,
          expr1: result,
          expr2: canonicalizeExpression(chain[i].rhs),
        };
      }
      return result;
    }
  }
}

function canonicalizeMetadata(meta: MetadataSpec): unknown {
  return meta
    .entrySeq()
    .sortBy(([k]) => k)
    .map(([k, v]) => {
      if (v.type === 'number') {
        return [k, { type: 'number', value: canonicalizeExpression(v.value) }];
      }
      if (v.type === 'amount') {
        return [
          k,
          {
            type: 'amount',
            value: {
              amount: canonicalizeExpression(v.value.amount),
              currency: v.value.currency,
            },
          },
        ];
      }
      return [k, v];
    })
    .toArray();
}

function canonicalizeCondition(cond: ConditionExpression): CanonicalCondition {
  switch (cond.type) {
    case 'comparison': {
      let val: unknown = cond.value;
      if (cond.value.type === 'number') {
        val = {
          type: 'number',
          value: canonicalizeExpression(cond.value.value),
        };
      } else if (cond.value.type === 'amount') {
        val = {
          type: 'amount',
          value: {
            amount: canonicalizeExpression(cond.value.value.amount),
            currency: cond.value.value.currency,
          },
        };
      } else if (cond.value.type === 'duration') {
        val = {
          type: 'duration',
          value: cond.value.value.toString(),
          unit: cond.value.unit,
        };
      }
      return {
        type: 'comparison',
        attribute: cond.attribute,
        operator: cond.operator,
        value: val,
      };
    }
    case 'not':
      return { type: 'not', expr: canonicalizeCondition(cond.expr) };
    case 'and':
    case 'or': {
      const chain: {
        readonly op: 'and' | 'or';
        readonly rhs: ConditionExpression;
      }[] = [];
      let cur: ConditionExpression = cond;
      while (cur.type === 'and' || cur.type === 'or') {
        chain.push({ op: cur.type, rhs: cur.rhs });
        cur = cur.lhs;
      }
      let result = canonicalizeCondition(cur);
      for (let i = chain.length - 1; i >= 0; i--) {
        result = {
          type: chain[i].op,
          lhs: result,
          rhs: canonicalizeCondition(chain[i].rhs),
        };
      }
      return result;
    }
  }
}

function canonicalizeDirective(
  dir: DirectiveSpec,
  options: FormatOptions,
): unknown {
  const baseMeta = canonicalizeMetadata(dir.meta);
  switch (dir.type) {
    case 'currency':
    case 'commodity':
      return {
        type:
          options.currencyKeywordStyle === 'preserve' ? dir.type : 'currency',
        date: dir.date,
        currency: dir.currency,
        meta: baseMeta,
      };
    case 'account-rule':
      return {
        type: dir.type,
        name: dir.name,
        rules: dir.rules.map(r =>
          r.type === 'when'
            ? {
                type: 'when',
                condition: canonicalizeCondition(r.condition),
                outcome: r.outcome,
              }
            : r,
        ),
        meta: baseMeta,
      };
    case 'balance':
      return {
        type: dir.type,
        date: dir.date,
        meta: baseMeta,
        balances: dir.balances.map(b => ({
          account: b.account,
          amount: {
            amount: canonicalizeExpression(b.amount.amount),
            currency: b.amount.currency,
          },
          approx: b.approx ? canonicalizeExpression(b.approx) : null,
        })),
      };
    case 'price':
      return {
        type: dir.type,
        date: dir.date,
        currency: dir.currency,
        price: {
          amount: canonicalizeExpression(dir.price.amount),
          currency: dir.price.currency,
        },
        meta: baseMeta,
      };
    case 'transaction':
      return {
        type: dir.type,
        date: dir.date,
        description: dir.description,
        flag: dir.flag,
        meta: baseMeta,
        postings: dir.postings.map(p => {
          if ('costSpec' in p) {
            return {
              kind: 'account',
              account: p.account,
              flag: p.flag,
              amount: p.amount
                ? {
                    amount: canonicalizeExpression(p.amount.amount),
                    currency: p.amount.currency,
                  }
                : null,
              costSpec: p.costSpec
                ? {
                    kind: p.costSpec.kind,
                    amounts: p.costSpec.amounts.map(a => ({
                      amount: canonicalizeExpression(a.amount),
                      currency: a.currency,
                    })),
                    currencies: p.costSpec.currencies,
                    dates: p.costSpec.dates,
                    tags: p.costSpec.tags,
                  }
                : null,
              priceSpec: p.priceSpec
                ? {
                    kind: p.priceSpec.kind,
                    amount: {
                      amount: canonicalizeExpression(p.priceSpec.amount.amount),
                      currency: p.priceSpec.amount.currency,
                    },
                  }
                : null,
              meta: canonicalizeMetadata(p.meta),
            };
          }
          return {
            kind: 'choice',
            flag: p.flag,
            account:
              p.account.type === 'ref'
                ? p.account
                : {
                    type: 'inline',
                    rules: p.account.rules.map(r =>
                      r.type === 'when'
                        ? {
                            type: 'when',
                            condition: canonicalizeCondition(r.condition),
                            outcome: r.outcome,
                          }
                        : r,
                    ),
                  },
            meta: canonicalizeMetadata(p.meta),
          };
        }),
      };
    case 'close':
    case 'load':
    case 'open':
    case 'option':
      return {
        ...dir,
        srcPos: undefined,
        meta: baseMeta,
      };
  }
}

function canonicalizeSpec(
  spec: LedgerSpec,
  options: FormatOptions,
): readonly unknown[] {
  return spec.directives.map(d => canonicalizeDirective(d, options));
}

function areCanonicalValuesEqual(rootA: unknown, rootB: unknown): boolean {
  const stack: [unknown, unknown][] = [[rootA, rootB]];

  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (Object.is(a, b)) {
      continue;
    }
    if (
      typeof a !== 'object' ||
      typeof b !== 'object' ||
      a === null ||
      b === null
    ) {
      return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
      }
      for (let i = 0; i < a.length; i++) {
        stack.push([a[i], b[i]]);
      }
      continue;
    }
    const recA = a as Record<string, unknown>;
    const recB = b as Record<string, unknown>;
    const keysA = Object.keys(recA).filter(k => recA[k] !== undefined);
    const keysB = Object.keys(recB).filter(k => recB[k] !== undefined);
    if (keysA.length !== keysB.length) {
      return false;
    }
    for (const key of keysA) {
      if (!Object.hasOwn(recB, key) || recB[key] === undefined) {
        return false;
      }
      stack.push([recA[key], recB[key]]);
    }
  }

  return true;
}

function collectNormalizedComments(tree: SyntaxTree): string[] {
  const comments: string[] = [];

  const pushTrivia = (items: readonly TriviaItem[]) => {
    for (const item of items) {
      if (item.kind === 'comment') {
        comments.push(normalizeCommentText(item.text));
      }
    }
  };

  let cur: RichToken | undefined =
    tree.directives.length > 0
      ? firstDirectiveToken(tree.directives[0])
      : undefined;
  while (cur !== undefined) {
    pushTrivia(cur.leadingTrivia);
    if (cur.trailingComment !== null) {
      comments.push(normalizeCommentText(cur.trailingComment.text));
    }
    cur = cur.next;
  }
  pushTrivia(tree.eofTrivia);

  return comments;
}

/**
 * Verifies semantic and comment equivalence of formatted Ledger output.
 *
 * Re-parses `formattedSource` and checks that lowered `LedgerSpec` semantics
 * and normalized `;` comments match `originalTree`.
 *
 * @param originalTree Original parsed CST before formatting.
 * @param formattedSource Newly formatted Ledger text to validate.
 * @param options Active formatting options.
 * @returns `Right(undefined)` if valid, or a `FormatError` if verification
 *   fails.
 */
export function verifyFormattedOutput(
  originalTree: SyntaxTree,
  formattedSource: string,
  options: FormatOptions,
): E.Either<FormatError, void> {
  const parsedFormatted = parseSyntax(formattedSource);
  if (E.isLeft(parsedFormatted)) {
    return E.left(
      new FormatError(
        `Internal formatter safety check failed (invalid syntax produced): ${parsedFormatted.left.message}`,
        parsedFormatted.left.srcPos,
      ),
    );
  }

  const specBefore = lowerSyntaxTree(originalTree);
  const specAfter = lowerSyntaxTree(parsedFormatted.right);

  if (
    !areCanonicalValuesEqual(
      canonicalizeSpec(specBefore, options),
      canonicalizeSpec(specAfter, options),
    )
  ) {
    return E.left(
      new FormatError(
        'Internal formatter safety check failed: semantic LedgerSpec changed after formatting',
      ),
    );
  }

  const commentsBefore = collectNormalizedComments(originalTree);
  const commentsAfter = collectNormalizedComments(parsedFormatted.right);

  if (
    commentsBefore.length !== commentsAfter.length ||
    commentsBefore.some((c, idx) => c !== commentsAfter[idx])
  ) {
    return E.left(
      new FormatError(
        'Internal formatter safety check failed: comments were altered or reordered during formatting',
      ),
    );
  }

  return E.right(undefined);
}
