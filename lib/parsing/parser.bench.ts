import { either as E } from 'fp-ts';

import type { BenchCase, BenchSuite } from '../testing/bench.js';
import { tokenize } from './internal/tokenizer.js';
import { parse } from './parser.js';

type Mode = 'parse' | 'tokenize' | 'parse-error';
type ParserGroup = 'mixed' | 'syntax' | 'scaling';

const CURRENCIES = ['CHF', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'VT-ETF'];
const ACCOUNTS = [
  'Assets:Bank',
  'Assets:Brokerage',
  'Assets:Crypto',
  'Liabilities:Credit-Card',
  'Income:Salary',
  'Income:Dividends',
  'Expenses:Groceries',
  'Expenses:Household:Rent',
  'Expenses:Misc',
  'Equity:Opening-Balances',
];

function formatDate(index: number): string {
  const year = 2015 + (Math.floor(index / 336) % 15);
  const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, '0');
  const day = String((index % 28) + 1).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeCase(
  id: string,
  group: ParserGroup,
  description: string,
  source: string,
  expectedDirectives: number,
  options?: {
    readonly mode?: Mode;
    readonly heavy?: boolean;
  },
): BenchCase {
  const mode = options?.mode ?? 'parse';
  const mb = Buffer.byteLength(source, 'utf8') / (1024 * 1024);

  if (mode === 'tokenize') {
    return {
      id,
      group,
      description,
      work: { MB: mb, dirs: expectedDirectives },
      heavy: options?.heavy,
      run: () => {
        let count = 0;
        for (let tok = tokenize(source); tok !== undefined; tok = tok.next) {
          count++;
        }
        if (count === 0) {
          throw new Error(`Case "${id}" produced 0 tokens`);
        }
        return count;
      },
    };
  }

  if (mode === 'parse-error') {
    return {
      id,
      group,
      description,
      work: { MB: mb },
      heavy: options?.heavy,
      run: () => {
        const res = parse(source);
        if (E.isRight(res)) {
          throw new Error(`Case "${id}" was expected to fail, but succeeded`);
        }
        return res.left.srcPos.row;
      },
    };
  }

  return {
    id,
    group,
    description,
    work: { MB: mb, dirs: expectedDirectives },
    heavy: options?.heavy,
    run: () => {
      const res = parse(source);
      if (E.isLeft(res)) {
        throw new Error(
          `Case "${id}" failed to parse at line ${res.left.srcPos.row}: ${res.left.message}`,
        );
      }
      if (res.right.directives.length !== expectedDirectives) {
        throw new Error(
          `Case "${id}" expected ${expectedDirectives} directives, got ${res.right.directives.length}`,
        );
      }
      return res.right.directives.length;
    },
  };
}

function generateMixedLedger(directiveCount: number): {
  source: string;
  directives: number;
} {
  const chunks: string[] = [
    '; Auto-generated realistic mixed ledger for parser benchmarking',
  ];
  let count = 0;

  const push = (text: string) => {
    chunks.push(text);
    count++;
  };

  if (count < directiveCount) {
    push('option "timezone" "Europe/Zurich"');
  }
  if (count < directiveCount) {
    push('option "booking-method" "FIFO"');
  }
  for (let i = 0; i < 4 && count < directiveCount; i++) {
    push(`2015-01-01 currency ${CURRENCIES[i]}\n  name: "Currency ${i}"`);
  }
  for (let i = 0; i < ACCOUNTS.length && count < directiveCount; i++) {
    push(`2015-01-01 open ${ACCOUNTS[i]} ${CURRENCIES[i % 3]}`);
  }
  if (count < directiveCount) {
    push(
      [
        'account-rule "auto-routing" {',
        '  when direction is debit and amount >= 100 CHF: Expenses:Household:Rent,',
        '  when currency is USD or currency is EUR: Assets:Brokerage,',
        '  when label == "ignored": break,',
        '  otherwise: Expenses:Groceries,',
        '}',
      ].join('\n'),
    );
  }

  let idx = 0;
  while (count < directiveCount) {
    const date = formatDate(idx);
    const mod = idx % 100;
    const ccyA = CURRENCIES[idx % 4];
    const ccyB = CURRENCIES[(idx + 1) % 4];
    const accA = ACCOUNTS[idx % ACCOUNTS.length];
    const accB = ACCOUNTS[(idx + 3) % ACCOUNTS.length];

    if (idx % 25 === 0) {
      chunks.push(`; Monthly ledger checkpoint #${idx}`);
    }

    if (mod < 65) {
      const variant = idx % 5;
      const amt = ((idx % 900) + 10.25).toFixed(2);
      if (variant === 0) {
        push(
          [
            `${date} * "Groceries #${idx}"`,
            `  ${accA}  -${amt} ${ccyA}`,
            `  ${accB}   ${amt} ${ccyA}`,
          ].join('\n'),
        );
      } else if (variant === 1) {
        push(
          [
            `${date} 12:30 * "FX & Investment #${idx}"`,
            `  ref: "tx-${idx}"`,
            `  Assets:Brokerage  10 VT-ETF { ${amt} ${ccyA}, ${date}, "lot-${idx % 7}" } @ ${amt} ${ccyB}`,
            `  Expenses:Misc           (1.50 + 0.25 * 2) ${ccyA}`,
            `  Assets:Bank`,
          ].join('\n'),
        );
      } else if (variant === 2) {
        push(
          [
            `${date} txn "Rule-routed transfer #${idx}"`,
            `  Assets:Bank  -${amt} ${ccyA}`,
            `  choose account "auto-routing"`,
            `    tag: "routed"`,
          ].join('\n'),
        );
      } else if (variant === 3) {
        push(
          [
            `${date} ! "Rebalance #${idx}"`,
            `  ! Assets:Crypto  -0.5 BTC {{ ${amt} ${ccyA} }} @@ ${amt} ${ccyB}`,
            `    venue: "exchange-${idx % 3}"`,
            `  choose account { when amount > 50 ${ccyA}: Income:Dividends, otherwise: Expenses:Groceries }`,
          ].join('\n'),
        );
      } else {
        push(
          [
            `${date} * "Split bill #${idx}"`,
            `  ${accA}  -(${amt} / 2) ${ccyA}`,
            `  ${accB}   (${amt} / 4) ${ccyA}`,
            `  Liabilities:Credit-Card`,
          ].join('\n'),
        );
      }
    } else if (mod < 83) {
      const rate = (0.85 + (idx % 30) * 0.01).toFixed(4);
      push(`${date} price ${ccyA} ${rate} ${ccyB}`);
    } else if (mod < 91) {
      push(
        [
          `${date} balance`,
          `  ${accA}  ${(idx % 5000) + 100}.00 ${ccyA}`,
          `  ${accB}  ${(idx % 500) + 10}.00 ${ccyB} ~ 0.01`,
        ].join('\n'),
      );
    } else if (mod < 95) {
      push(
        [
          `account-rule "rule-${idx}" {`,
          `  when amount >= ${(idx % 200) + 1} ${ccyA} and not label == "skip": ${accA},`,
          `  when duration > 30d: ${accB},`,
          `  otherwise: fail "unmatched-${idx}",`,
          '}',
        ].join('\n'),
      );
    } else if (mod < 98) {
      if (idx % 2 === 0) {
        push(`${date} open Assets:Temp:Acct${idx} ${ccyA}`);
      } else {
        push(`${date} close Assets:Temp:Acct${idx - 1}`);
      }
    } else if (mod === 98) {
      push(`${date} commodity C${idx % 50}`);
    } else {
      push(`load "sub/file-${idx % 10}.ledger"`);
    }

    idx++;
  }

  return { source: chunks.join('\n\n') + '\n', directives: count };
}

function generateRichTransactions(count: number): {
  source: string;
  directives: number;
} {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = formatDate(i);
    const ccy = CURRENCIES[i % CURRENCIES.length];
    const amt = ((i % 500) + 1.5).toFixed(2);
    chunks.push(
      [
        `${date} 09:15:30 +01:00 * "Complex trade #${i}"`,
        `  trade-id: "tr-${i}"`,
        `  desk: Assets:Brokerage`,
        `  Assets:Brokerage  10 VT-ETF { ${amt} ${ccy}, ${date} 09:15 Z, "batch-${i % 5}" } @ ${amt} USD`,
        `    clearing: "prime"`,
        `  ! Assets:Crypto        -0.25 ETH {{ 500.00 EUR }} @@ 550.00 USD`,
        `  Expenses:Misc           (1.25 + 0.75 * 3) / 2 ${ccy}`,
        `  Assets:Bank`,
      ].join('\n'),
    );
  }
  return { source: chunks.join('\n\n') + '\n', directives: count };
}

function generateNestedExpression(depth: number, seed: number): string {
  if (depth <= 0) {
    return `${(seed % 97) + 1}.${seed % 10}`;
  }
  const op = ['+', '-', '*', '/'][depth % 4];
  const inner = generateNestedExpression(depth - 1, seed + 1);
  return `(${inner} ${op} ${(depth % 9) + 1})`;
}

function generateExpressions(
  count: number,
  depth: number,
): { source: string; directives: number } {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = formatDate(i);
    const expr = generateNestedExpression(depth, i);
    chunks.push(`${date} balance\n  Assets:Bank  ${expr} CHF`);
  }
  return { source: chunks.join('\n\n') + '\n', directives: count };
}

function generateMetadataHeavy(count: number): {
  source: string;
  directives: number;
} {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = formatDate(i);
    chunks.push(
      [
        `${date} * "Metadata tx #${i}"`,
        `  str-meta: "value-${i}"`,
        `  acct-meta: Assets:Bank`,
        `  ccy-meta: CHF`,
        `  date-meta: ${date}`,
        `  num-meta: 1,234.56`,
        `  amt-meta: 42.00 EUR`,
        `  Assets:Bank  -10.00 CHF`,
        `    p-str: "posting-${i}"`,
        `    p-amt: 10.00 CHF`,
        `  Expenses:Groceries  10.00 CHF`,
        `    p-ccy: USD`,
      ].join('\n'),
    );
  }
  return { source: chunks.join('\n\n') + '\n', directives: count };
}

function generateNestedCondition(depth: number, seed: number): string {
  if (depth <= 0) {
    const clauses = [
      `amount >= ${(seed % 50) + 1} CHF`,
      `currency is USD`,
      `label == "tag-${seed % 10}"`,
      `duration > ${(seed % 30) + 1}d`,
      `date is 2025-06-01`,
      `account is Assets:Bank`,
    ];
    return clauses[seed % clauses.length];
  }
  const op = depth % 2 === 0 ? 'and' : 'or';
  const prefix = depth % 3 === 0 ? 'not ' : '';
  return `${prefix}(${generateNestedCondition(depth - 1, seed + 1)} ${op} number != ${depth})`;
}

function generateAccountRules(
  count: number,
  condDepth: number,
): { source: string; directives: number } {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const c1 = generateNestedCondition(condDepth, i);
    const c2 = generateNestedCondition(Math.max(1, condDepth - 1), i + 7);
    chunks.push(
      [
        `account-rule "rule-${i}" {`,
        `  when ${c1}: Assets:Bank,`,
        `  when ${c2}: break,`,
        `  when label == "err-${i}": fail "rejected",`,
        `  otherwise: Expenses:Groceries,`,
        '}',
      ].join('\n'),
    );
  }
  return { source: chunks.join('\n\n') + '\n', directives: count };
}

function generateCommentsHeavy(count: number): {
  source: string;
  directives: number;
} {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = formatDate(i);
    chunks.push(
      [
        `; Section header comment for entry #${i} with extra explanation text`,
        `; Additional context line explaining accounting treatment and tax notes`,
        `; Third comment line referencing receipt-${i}.pdf and vendor details`,
        `${date} * "Commented tx #${i}" ; inline comment`,
        `  Assets:Bank     -25.00 CHF ; outflow`,
        `  Expenses:Groceries   25.00 CHF ; inflow`,
      ].join('\n'),
    );
  }
  return { source: chunks.join('\n\n') + '\n', directives: count };
}

function generateWideTransactions(
  txnCount: number,
  postingsPerTxn: number,
): { source: string; directives: number } {
  const chunks: string[] = [];
  for (let i = 0; i < txnCount; i++) {
    const date = formatDate(i);
    const lines = [`${date} * "Wide txn #${i}"`];
    for (let p = 0; p < postingsPerTxn - 1; p++) {
      lines.push(
        `  ${ACCOUNTS[p % ACCOUNTS.length]}  ${(p + 1).toFixed(2)} CHF`,
      );
    }
    lines.push('  Assets:Bank');
    chunks.push(lines.join('\n'));
  }
  return { source: chunks.join('\n\n') + '\n', directives: txnCount };
}

function generateSyntaxErrorInput(validCount: number): {
  source: string;
  directives: number;
} {
  const valid = generateMixedLedger(validCount);
  const broken =
    valid.source +
    '\n2026-01-01 * "Broken directive"\n  Assets:Bank  ((1 + 2 CHF\n';
  return { source: broken, directives: 0 };
}

export function createSuite(): BenchSuite {
  const mixed5k = generateMixedLedger(5_000);
  const mixed50k = generateMixedLedger(50_000);
  const richTxns = generateRichTransactions(1_000);
  const exprStress = generateExpressions(1_000, 4);
  const metaHeavy = generateMetadataHeavy(1_000);
  const accountRules = generateAccountRules(400, 3);
  const commentsHeavy = generateCommentsHeavy(1_000);
  const syntaxErr = generateSyntaxErrorInput(1_000);

  const scaleExprSmall = generateExpressions(400, 4);
  const scaleExprLarge = generateExpressions(400, 16);
  const scaleCondSmall = generateAccountRules(250, 3);
  const scaleCondLarge = generateAccountRules(250, 12);
  const scalePostingsSmall = generateWideTransactions(400, 5);
  const scalePostingsLarge = generateWideTransactions(40, 50);

  return {
    name: 'parsing',
    cases: [
      makeCase(
        'mixed-5k',
        'mixed',
        'Realistic mixed ledger (5,000 directives)',
        mixed5k.source,
        mixed5k.directives,
      ),
      makeCase(
        'mixed-50k',
        'mixed',
        'Realistic mixed ledger (50,000 directives)',
        mixed50k.source,
        mixed50k.directives,
        { heavy: true },
      ),
      makeCase(
        'tokenize-5k',
        'mixed',
        'Tokenize-only on 5,000-directive ledger',
        mixed5k.source,
        mixed5k.directives,
        { mode: 'tokenize' },
      ),
      makeCase(
        'tokenize-50k',
        'mixed',
        'Tokenize-only on 50,000-directive ledger',
        mixed50k.source,
        mixed50k.directives,
        { mode: 'tokenize', heavy: true },
      ),

      makeCase(
        'syntax-transactions',
        'syntax',
        'Rich transactions with costs, prices, expressions, metadata (1k)',
        richTxns.source,
        richTxns.directives,
      ),
      makeCase(
        'syntax-expressions',
        'syntax',
        'Nested arithmetic expressions in amounts (1k)',
        exprStress.source,
        exprStress.directives,
      ),
      makeCase(
        'syntax-metadata',
        'syntax',
        'Metadata-heavy directives and postings (1k)',
        metaHeavy.source,
        metaHeavy.directives,
      ),
      makeCase(
        'syntax-account-rules',
        'syntax',
        'Account-rule boolean conditions and outcomes (400)',
        accountRules.source,
        accountRules.directives,
      ),
      makeCase(
        'syntax-comments',
        'syntax',
        'Comment-dense ledger (1k directives + 5k comment lines)',
        commentsHeavy.source,
        commentsHeavy.directives,
      ),
      makeCase(
        'syntax-error',
        'syntax',
        'Malformed directive at end of 1k-directive ledger',
        syntaxErr.source,
        syntaxErr.directives,
        { mode: 'parse-error' },
      ),

      makeCase(
        'scale-expr-depth-4',
        'scaling',
        'Expression nesting depth 4 (400 directives)',
        scaleExprSmall.source,
        scaleExprSmall.directives,
      ),
      makeCase(
        'scale-expr-depth-16',
        'scaling',
        'Expression nesting depth 16 (400 directives)',
        scaleExprLarge.source,
        scaleExprLarge.directives,
      ),
      makeCase(
        'scale-cond-depth-3',
        'scaling',
        'Condition nesting depth 3 (250 rules)',
        scaleCondSmall.source,
        scaleCondSmall.directives,
      ),
      makeCase(
        'scale-cond-depth-12',
        'scaling',
        'Condition nesting depth 12 (250 rules)',
        scaleCondLarge.source,
        scaleCondLarge.directives,
      ),
      makeCase(
        'scale-postings-5',
        'scaling',
        '400 transactions x 5 postings',
        scalePostingsSmall.source,
        scalePostingsSmall.directives,
      ),
      makeCase(
        'scale-postings-50',
        'scaling',
        '40 transactions x 50 postings',
        scalePostingsLarge.source,
        scalePostingsLarge.directives,
      ),
    ],
    scalingChecks: [
      {
        id: 'mixed-file-size',
        label: 'Mixed ledger size (5k -> 50k directives)',
        smallId: 'mixed-5k',
        largeId: 'mixed-50k',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.0,
      },
      {
        id: 'tokenize-file-size',
        label: 'Tokenizer size (5k -> 50k directives)',
        smallId: 'tokenize-5k',
        largeId: 'tokenize-50k',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.0,
      },
      {
        id: 'expr-nesting',
        label: 'Arithmetic expression nesting (depth 4 -> 16)',
        smallId: 'scale-expr-depth-4',
        largeId: 'scale-expr-depth-16',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.5,
      },
      {
        id: 'cond-nesting',
        label: 'Account-rule condition nesting (depth 3 -> 12)',
        smallId: 'scale-cond-depth-3',
        largeId: 'scale-cond-depth-12',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.5,
      },
      {
        id: 'wide-transactions',
        label: 'Postings per transaction (5 -> 50 postings)',
        smallId: 'scale-postings-5',
        largeId: 'scale-postings-50',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.5,
      },
    ],
  };
}
