import { either as E } from 'fp-ts';

import type { BenchCase, BenchSuite } from '../testing/bench.js';
import { format, FormatOptions } from './formatter.js';

type FormatterGroup = 'mixed' | 'workload' | 'scaling';

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
  group: FormatterGroup,
  description: string,
  source: string,
  expectedDirectives: number,
  options?: {
    readonly formatOptions?: Partial<FormatOptions>;
    readonly heavy?: boolean;
  },
): BenchCase {
  const mb = Buffer.byteLength(source, 'utf8') / (1024 * 1024);
  const fmtOpts = options?.formatOptions;

  return {
    id,
    group,
    description,
    work: { MB: mb, dirs: expectedDirectives },
    heavy: options?.heavy,
    run: () => {
      const res = format(source, fmtOpts);
      if (E.isLeft(res)) {
        throw new Error(`Case "${id}" failed to format: ${res.left.message}`);
      }
      if (res.right.length === 0) {
        throw new Error(`Case "${id}" produced empty formatted output`);
      }
      return res.right.length;
    },
  };
}

function generateMixedLedger(directiveCount: number): {
  source: string;
  directives: number;
} {
  const chunks: string[] = [
    ';Auto-generated realistic unformatted ledger for formatter benchmarking',
  ];
  let count = 0;

  const push = (text: string) => {
    chunks.push(text);
    count++;
  };

  if (count < directiveCount) {
    push('option   "timezone"   "Europe/Zurich"');
  }
  if (count < directiveCount) {
    push('option "booking-method"   "FIFO"');
  }
  for (let i = 0; i < 4 && count < directiveCount; i++) {
    push(
      `2015-01-01   currency   ${CURRENCIES[i]}\n    name:   "Currency ${i}"`,
    );
  }
  for (let i = 0; i < ACCOUNTS.length && count < directiveCount; i++) {
    push(`2015-01-01  open   ${ACCOUNTS[i]}   ${CURRENCIES[i % 3]}`);
  }
  if (count < directiveCount) {
    push(
      [
        'account-rule "auto-routing" {',
        '    when direction is debit and amount >= 100 CHF: Expenses:Household:Rent,',
        '  when currency is USD or currency is EUR: Assets:Brokerage,',
        '   when label == "ignored": break,',
        '      otherwise: Expenses:Groceries',
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
      chunks.push(`;Monthly ledger checkpoint #${idx}   `);
    }

    if (mod < 65) {
      const variant = idx % 5;
      const amt = ((idx % 900) + 10.25).toFixed(2);
      if (variant === 0) {
        push(
          [
            `${date}   *   "Groceries #${idx}" ;inline`,
            `    ${accA} -${amt} ${ccyA}`,
            `  ${accB}    ${amt} ${ccyA} ;matched`,
          ].join('\n'),
        );
      } else if (variant === 1) {
        push(
          [
            `${date}  12:30   *  "FX & Investment #${idx}"`,
            `    ref: "tx-${idx}"`,
            `  Assets:Brokerage 10 VT-ETF {${amt} ${ccyA}, ${date}, "lot-${idx % 7}"} @ ${amt} ${ccyB}`,
            `  Expenses:Misc  (1.50+0.25*2) ${ccyA}`,
            `  Assets:Bank`,
          ].join('\n'),
        );
      } else if (variant === 2) {
        push(
          [
            `${date} txn "Rule-routed transfer #${idx}"`,
            `  Assets:Bank -${amt} ${ccyA}`,
            `  choose account "auto-routing"`,
            `      tag: "routed"`,
          ].join('\n'),
        );
      } else if (variant === 3) {
        push(
          [
            `${date} ! "Rebalance #${idx}"`,
            `  ! Assets:Crypto -0.5 BTC {{${amt} ${ccyA}}} @@ ${amt} ${ccyB}`,
            `    venue: "exchange-${idx % 3}"`,
            `  choose account { when amount > 50 ${ccyA}: Income:Dividends, otherwise: Expenses:Groceries }`,
          ].join('\n'),
        );
      } else {
        push(
          [
            `${date} * "Split bill #${idx}"`,
            `  ${accA} -(${amt} / 2) ${ccyA}`,
            `  ${accB} (${amt} / 4) ${ccyA}`,
            `  Liabilities:Credit-Card`,
          ].join('\n'),
        );
      }
    } else if (mod < 83) {
      const rate = (0.85 + (idx % 30) * 0.01).toFixed(4);
      push(`${date}   price   ${ccyA}   ${rate}   ${ccyB}`);
    } else if (mod < 91) {
      push(
        [
          `${date} balance`,
          `    ${accA} ${(idx % 5000) + 100}.00 ${ccyA}`,
          `  ${accB} ${(idx % 500) + 10}.00 ${ccyB} ~ 0.01`,
        ].join('\n'),
      );
    } else if (mod < 95) {
      push(
        [
          `account-rule "rule-${idx}" {`,
          `  when amount >= ${(idx % 200) + 1} ${ccyA} and not label == "skip": ${accA},`,
          `  when duration > 30d: ${accB},`,
          `  otherwise: fail "unmatched-${idx}"`,
          '}',
        ].join('\n'),
      );
    } else if (mod < 98) {
      if (idx % 2 === 0) {
        push(`${date}  open  Assets:Temp:Acct${idx}  ${ccyA}`);
      } else {
        push(`${date}  close  Assets:Temp:Acct${idx - 1}`);
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

function generateCommentsHeavy(count: number): {
  source: string;
  directives: number;
} {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = formatDate(i);
    chunks.push(
      [
        `;Section header comment for entry #${i} with extra explanation text   `,
        `; Additional context line explaining accounting treatment and tax notes`,
        `${date} * "Commented tx #${i}" ;inline comment`,
        `  Assets:Bank -25.00 CHF ;outflow`,
        `  Expenses:Household:Rent 15.00 CHF ;rent share`,
        `  Expenses:Groceries 10.00 CHF ;inflow`,
      ].join('\n'),
    );
  }
  return { source: chunks.join('\n\n') + '\n', directives: count };
}

function generateWrappingWorkload(count: number): {
  source: string;
  directives: number;
} {
  const chunks: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = formatDate(i);
    if (i % 2 === 0) {
      chunks.push(
        [
          `account-rule "wrap-${i}" {`,
          `  when description == "Supermarket #${i}" and narration == "Weekly groceries" and amount >= ${(i % 500) + 50}.00 CHF: Expenses:Groceries,`,
          `  when currency is USD or currency is EUR or label == "fx-lot-${i % 10}": Assets:Brokerage,`,
          `  otherwise: fail "unmatched rule ${i}"`,
          '}',
        ].join('\n'),
      );
    } else {
      chunks.push(
        [
          `${date} * "Long trade #${i}"`,
          `  Assets:Brokerage:Retirement  10 VT-ETF { 185.50 USD, ${date} 14:30:00 Z, "lot-primary-${i}" } @ 190.00 USD`,
          `  Assets:Bank  -(100 + 200 + 300 + 400 + 500 + 600) USD`,
        ].join('\n'),
      );
    }
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
        `  ${ACCOUNTS[p % ACCOUNTS.length]} ${(p + 1).toFixed(2)} CHF`,
      );
    }
    lines.push('  Assets:Bank');
    chunks.push(lines.join('\n'));
  }
  return { source: chunks.join('\n\n') + '\n', directives: txnCount };
}

function generateLongExpressionChains(
  directiveCount: number,
  termsPerExpr: number,
): { source: string; directives: number } {
  const chunks: string[] = [];
  const expr = Array.from({ length: termsPerExpr }, (_, i) =>
    String((i % 97) + 1),
  ).join(' + ');
  for (let i = 0; i < directiveCount; i++) {
    chunks.push(`${formatDate(i)} balance\n  Assets:Bank  ${expr} CHF`);
  }
  return { source: chunks.join('\n\n') + '\n', directives: directiveCount };
}

function generateLongConditionChains(
  directiveCount: number,
  clausesPerRule: number,
): { source: string; directives: number } {
  const chunks: string[] = [];
  const cond = Array.from(
    { length: clausesPerRule },
    (_, i) => `a${i % 10} == ${i % 100}`,
  ).join(' and ');
  for (let i = 0; i < directiveCount; i++) {
    chunks.push(`account-rule "chain-${i}" {\n  when ${cond}: Assets:Bank,\n}`);
  }
  return { source: chunks.join('\n\n') + '\n', directives: directiveCount };
}

export function createSuite(): BenchSuite {
  const mixed1k = generateMixedLedger(1_000);
  const mixed5k = generateMixedLedger(5_000);
  const mixed10k = generateMixedLedger(10_000);
  const formatted1kRes = format(mixed1k.source);
  if (E.isLeft(formatted1kRes)) {
    throw formatted1kRes.left;
  }

  const commentsHeavy = generateCommentsHeavy(500);
  const wrapWorkload = generateWrappingWorkload(400);

  const alignSmall = generateMixedLedger(500);
  const alignLarge = generateMixedLedger(2_500);
  const wideSmall = generateWideTransactions(200, 5);
  const wideLarge = generateWideTransactions(20, 50);
  const exprSmall = generateLongExpressionChains(20, 100);
  const exprLarge = generateLongExpressionChains(2, 1_000);
  const condSmall = generateLongConditionChains(20, 50);
  const condLarge = generateLongConditionChains(2, 500);

  return {
    name: 'formatting',
    cases: [
      makeCase(
        'mixed-1k',
        'mixed',
        'Format realistic unformatted ledger (1,000 directives)',
        mixed1k.source,
        mixed1k.directives,
      ),
      makeCase(
        'mixed-1k-idempotent',
        'mixed',
        'Re-format already formatted ledger (1,000 directives)',
        formatted1kRes.right,
        mixed1k.directives,
      ),
      makeCase(
        'mixed-5k',
        'mixed',
        'Format realistic unformatted ledger (5,000 directives)',
        mixed5k.source,
        mixed5k.directives,
      ),
      makeCase(
        'mixed-10k',
        'mixed',
        'Format realistic unformatted ledger (10,000 directives)',
        mixed10k.source,
        mixed10k.directives,
        { heavy: true },
      ),

      makeCase(
        'align-file-1k',
        'workload',
        'Whole-file alignment across 1,000 directives',
        mixed1k.source,
        mixed1k.directives,
        { formatOptions: { alignScope: 'file', alignMode: 'currency' } },
      ),
      makeCase(
        'align-grow-only-decimal-1k',
        'workload',
        'Grow-only decimal-and-currency alignment + thousands separators (1k)',
        mixed1k.source,
        mixed1k.directives,
        {
          formatOptions: {
            alignScope: 'file-grow-only',
            alignMode: 'decimal-and-currency',
            thousandsSeparator: 'add',
          },
        },
      ),
      makeCase(
        'comments-aligned-500',
        'workload',
        'Comment-dense ledger with alignTrailingComments=true (500 txns)',
        commentsHeavy.source,
        commentsHeavy.directives,
        { formatOptions: { alignTrailingComments: true } },
      ),
      makeCase(
        'wrap-rules-and-costs',
        'workload',
        'Narrow printWidth=60 wrapping rules, cost specs, and expressions (400)',
        wrapWorkload.source,
        wrapWorkload.directives,
        { formatOptions: { printWidth: 60 } },
      ),

      makeCase(
        'scale-align-file-500',
        'scaling',
        'Whole-file alignment (500 directives)',
        alignSmall.source,
        alignSmall.directives,
        {
          formatOptions: {
            alignScope: 'file',
            alignMode: 'decimal-and-currency',
          },
        },
      ),
      makeCase(
        'scale-align-file-2500',
        'scaling',
        'Whole-file alignment (2,500 directives)',
        alignLarge.source,
        alignLarge.directives,
        {
          formatOptions: {
            alignScope: 'file',
            alignMode: 'decimal-and-currency',
          },
        },
      ),
      makeCase(
        'scale-postings-5',
        'scaling',
        '200 transactions x 5 postings',
        wideSmall.source,
        wideSmall.directives,
      ),
      makeCase(
        'scale-postings-50',
        'scaling',
        '20 transactions x 50 postings',
        wideLarge.source,
        wideLarge.directives,
      ),
      makeCase(
        'scale-expr-chain-100',
        'scaling',
        '20 directives x 100-term arithmetic sum',
        exprSmall.source,
        exprSmall.directives,
      ),
      makeCase(
        'scale-expr-chain-1000',
        'scaling',
        '2 directives x 1,000-term arithmetic sum',
        exprLarge.source,
        exprLarge.directives,
      ),
      makeCase(
        'scale-cond-chain-50',
        'scaling',
        '20 account-rules x 50-clause boolean chain',
        condSmall.source,
        condSmall.directives,
      ),
      makeCase(
        'scale-cond-chain-500',
        'scaling',
        '2 account-rules x 500-clause boolean chain',
        condLarge.source,
        condLarge.directives,
      ),
    ],
    scalingChecks: [
      {
        id: 'mixed-file-size',
        label: 'Mixed ledger size (1k -> 5k directives)',
        smallId: 'mixed-1k',
        largeId: 'mixed-5k',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.0,
      },
      {
        id: 'align-file-size',
        label: 'Whole-file alignment (500 -> 2.5k directives)',
        smallId: 'scale-align-file-500',
        largeId: 'scale-align-file-2500',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.0,
      },
      {
        id: 'wide-transactions',
        label: 'Postings per transaction (5 -> 50 postings)',
        smallId: 'scale-postings-5',
        largeId: 'scale-postings-50',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.5,
      },
      {
        id: 'expr-chain-length',
        label: 'Arithmetic chain length (100 -> 1,000 terms)',
        smallId: 'scale-expr-chain-100',
        largeId: 'scale-expr-chain-1000',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.5,
      },
      {
        id: 'cond-chain-length',
        label: 'Boolean condition chain length (50 -> 500 clauses)',
        smallId: 'scale-cond-chain-50',
        largeId: 'scale-cond-chain-500',
        sizeUnit: 'MB',
        maxNormalizedRatio: 2.5,
      },
    ],
  };
}
