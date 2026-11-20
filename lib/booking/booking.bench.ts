import { ExactNumber } from 'exactnumber';
import { either as E } from 'fp-ts';
import { Map as ImmutableMap } from 'immutable';

import {
  getAccountTypeUnchecked,
  getDefaultNormalBalanceSide,
  NormalBalanceSide,
} from '../core/account.js';
import { Amount } from '../core/amount.js';
import { DefaultSignConvention } from '../core/sign-convention.js';
import { Directive } from '../loading/directive.js';
import {
  AccountChoiceRule,
  AccountRuleDirective,
} from '../loading/directives/account-choice.js';
import { BalanceDirective } from '../loading/directives/balance.js';
import { CurrencyDirective } from '../loading/directives/currency.js';
import { OpenDirective } from '../loading/directives/open.js';
import { PriceDirective } from '../loading/directives/price.js';
import {
  AccountChoicePosting,
  AccountPosting,
  CostSpec,
  Posting,
  PriceSpec,
  TransactionDirective,
} from '../loading/directives/transaction.js';
import { AccountMap, Ledger } from '../loading/ledger.js';
import { Metadata } from '../loading/metadata.js';
import { SourceContext } from '../loading/source-context.js';
import { DateSpec } from '../parsing/spec/date.js';
import type { BenchCase, BenchSuite } from '../testing/bench.js';
import { book } from './booking.js';

type BookingGroup = 'mixed' | 'workload' | 'scaling';

const EMPTY_META: Metadata = ImmutableMap();
const DEFAULT_OPTIONS: ImmutableMap<string, string> = ImmutableMap([
  ['account-reference-checks', 'strict'],
  ['booking-method', 'fifo'],
]);

const ACCOUNTS = [
  'Assets:Bank',
  'Assets:Brokerage',
  'Assets:Crypto',
  'Liabilities:Credit-Card',
  'Income:Salary',
  'Income:Dividends',
  'Income:Capital-Gains:Long-Term',
  'Income:Capital-Gains:Short-Term',
  'Expenses:Groceries',
  'Expenses:Household:Rent',
  'Expenses:Misc',
  'Expenses:Capital-Losses',
  'Equity:Opening-Balances',
  'Trading:Default',
] as const;

const CURRENCIES = ['CHF', 'USD', 'EUR', 'VT', 'BTC'] as const;

const START_MS = Date.UTC(2015, 0, 1);
const DAY_MS = 86_400_000;

function makeDate(dayOffset: number): { date: Date; dateSpec: DateSpec } {
  const date = new Date(START_MS + dayOffset * DAY_MS);
  const iso = date.toISOString().slice(0, 10);
  return {
    date,
    dateSpec: { date: iso, time: null, timezone: null },
  };
}

function makeSrcCtx(row: number): SourceContext {
  return { filePath: 'bench.ledger', row, col: 1 };
}

function amt(value: number | string, currency: string): Amount {
  return new Amount(ExactNumber(value), currency);
}

function normalSide(account: string): NormalBalanceSide {
  return getDefaultNormalBalanceSide(getAccountTypeUnchecked(account));
}

function accountPosting(
  account: string,
  amount: Amount | null,
  options?: {
    readonly costSpec?: CostSpec | null;
    readonly priceSpec?: PriceSpec | null;
    readonly meta?: Metadata;
  },
): AccountPosting {
  return {
    account,
    flag: '*',
    amount,
    costSpec: options?.costSpec ?? null,
    priceSpec: options?.priceSpec ?? null,
    meta: options?.meta ?? EMPTY_META,
    normalBalanceSide: normalSide(account),
  };
}

function choicePosting(
  account: AccountChoicePosting['account'],
): AccountChoicePosting {
  return {
    account,
    flag: '*',
    meta: EMPTY_META,
  };
}

function costAugment(
  unitCost: Amount,
  date: Date,
  dateSpec: DateSpec,
  tags: string[] = [],
): CostSpec {
  return {
    kind: 'per-unit',
    amounts: [unitCost],
    currencies: [],
    dates: [date],
    dateSpecs: [dateSpec],
    tags,
  };
}

function costReduce(options?: {
  readonly tags?: string[];
  readonly currencies?: string[];
}): CostSpec {
  return {
    kind: 'per-unit',
    amounts: [],
    currencies: options?.currencies ?? [],
    dates: [],
    dateSpecs: [],
    tags: options?.tags ?? [],
  };
}

function capitalGainsRules(): readonly AccountChoiceRule[] {
  return [
    {
      type: 'when',
      condition: {
        type: 'and',
        lhs: {
          type: 'comparison',
          attribute: 'direction',
          operator: 'is',
          value: { type: 'identifier', value: 'credit' },
        },
        rhs: {
          type: 'comparison',
          attribute: 'holding-period',
          operator: '>=',
          value: { type: 'duration', value: ExactNumber(365), unit: 'd' },
        },
      },
      outcome: { type: 'account', account: 'Income:Capital-Gains:Long-Term' },
    },
    {
      type: 'when',
      condition: {
        type: 'comparison',
        attribute: 'direction',
        operator: 'is',
        value: { type: 'identifier', value: 'credit' },
      },
      outcome: { type: 'account', account: 'Income:Capital-Gains:Short-Term' },
    },
    {
      type: 'otherwise',
      outcome: { type: 'account', account: 'Expenses:Capital-Losses' },
    },
  ];
}

class LedgerBuilder {
  private readonly directives: Directive[] = [];
  private readonly currencyMap = new Map<string, CurrencyDirective>();
  private readonly accountRuleMap = new Map<string, AccountRuleDirective>();
  private accountMap: AccountMap = ImmutableMap();
  private row = 1;
  private readonly optionMap: ImmutableMap<string, string>;

  constructor(options?: ReadonlyArray<[string, string]>) {
    this.optionMap = options
      ? DEFAULT_OPTIONS.merge(ImmutableMap(options))
      : DEFAULT_OPTIONS;
  }

  addCurrency(currency: string, dayOffset = 0): this {
    const { date } = makeDate(dayOffset);
    this.currencyMap.set(currency, {
      type: 'currency',
      date,
      currency,
      meta: EMPTY_META,
      srcCtx: makeSrcCtx(this.row++),
      optionMap: this.optionMap,
    });
    return this;
  }

  openAccount(
    account: string,
    dayOffset = 0,
    currencies: readonly string[] = [],
  ): this {
    const { date } = makeDate(dayOffset);
    const partial = {
      type: 'open' as const,
      date,
      account,
      currencies,
      meta: EMPTY_META,
      srcCtx: makeSrcCtx(this.row++),
      optionMap: this.optionMap,
    };
    this.accountMap = this.accountMap.set(account, { open: partial });
    const directive: OpenDirective = {
      ...partial,
      accountMap: this.accountMap,
    };
    this.directives.push(directive);
    return this;
  }

  addAccountRule(name: string, rules: readonly AccountChoiceRule[]): this {
    this.accountRuleMap.set(name, {
      type: 'account-rule',
      name,
      rules,
      meta: EMPTY_META,
      srcCtx: makeSrcCtx(this.row++),
      optionMap: this.optionMap,
    });
    return this;
  }

  addTransaction(
    dayOffset: number,
    description: string,
    postings: readonly Posting[],
  ): this {
    const { date, dateSpec } = makeDate(dayOffset);
    const directive: TransactionDirective = {
      type: 'transaction',
      date,
      dateSpec,
      description,
      flag: '*',
      postings,
      meta: EMPTY_META,
      signConvention: DefaultSignConvention,
      srcCtx: makeSrcCtx(this.row++),
      optionMap: this.optionMap,
    };
    this.directives.push(directive);
    return this;
  }

  addPrice(dayOffset: number, currency: string, price: Amount): this {
    const { date } = makeDate(dayOffset);
    const directive: PriceDirective = {
      type: 'price',
      date,
      currency,
      price,
      meta: EMPTY_META,
      srcCtx: makeSrcCtx(this.row++),
      optionMap: this.optionMap,
    };
    this.directives.push(directive);
    return this;
  }

  addBalance(
    dayOffset: number,
    entries: ReadonlyArray<{
      readonly account: string;
      readonly amount: Amount;
    }>,
  ): this {
    const { date } = makeDate(dayOffset);
    const directive: BalanceDirective = {
      type: 'balance',
      date,
      balances: entries.map(e => ({
        account: e.account,
        amount: e.amount,
        approx: null,
        normalBalanceSide: normalSide(e.account),
      })),
      meta: EMPTY_META,
      signConvention: DefaultSignConvention,
      srcCtx: makeSrcCtx(this.row++),
      optionMap: this.optionMap,
    };
    this.directives.push(directive);
    return this;
  }

  get directiveCount(): number {
    return this.directives.length;
  }

  build(): Ledger {
    return {
      directives: this.directives,
      currencyMap: ImmutableMap(this.currencyMap),
      accountMap: this.accountMap,
      accountRuleMap: ImmutableMap(this.accountRuleMap),
      signConvention: DefaultSignConvention,
    };
  }
}

function createStandardBuilder(
  options?: ReadonlyArray<[string, string]>,
): LedgerBuilder {
  const b = new LedgerBuilder(options);
  for (const c of CURRENCIES) {
    b.addCurrency(c, 0);
  }
  for (const a of ACCOUNTS) {
    b.openAccount(a, 0);
  }
  b.addAccountRule('cap-gains', capitalGainsRules());
  return b;
}

function buildMixedLedger(targetDirectives: number): {
  ledger: Ledger;
  expectedTransactions: number;
} {
  const b = createStandardBuilder();
  let expectedTransactions = 0;

  // Opening seed so balances stay realistic and verifiable.
  let bankChfCents = 10_000_000;
  let vtUnits = 0;
  b.addTransaction(1, 'Opening balance', [
    accountPosting('Assets:Bank', amt(100_000, 'CHF')),
    accountPosting('Assets:Bank', amt(50_000, 'USD')),
    accountPosting('Equity:Opening-Balances', null),
  ]);
  expectedTransactions++;

  let step = 0;
  while (b.directiveCount < targetDirectives) {
    const day = 2 + Math.floor(step / 3);
    const mod = step % 20;

    if (mod < 11) {
      // Everyday expense or salary transaction
      const cents = ((step % 25) + 1) * 500;
      const value = (cents / 100).toFixed(2);
      if (mod === 0) {
        bankChfCents += 500_000;
        b.addTransaction(day, `Salary #${step}`, [
          accountPosting('Assets:Bank', amt(5000, 'CHF')),
          accountPosting('Income:Salary', null),
        ]);
      } else if (mod % 3 === 0) {
        bankChfCents -= cents;
        const half = (cents / 200).toFixed(2);
        b.addTransaction(day, `Split expense #${step}`, [
          accountPosting('Expenses:Groceries', amt(half, 'CHF')),
          accountPosting('Expenses:Misc', amt(half, 'CHF')),
          accountPosting('Assets:Bank', null),
        ]);
      } else {
        bankChfCents -= cents;
        b.addTransaction(day, `Groceries #${step}`, [
          accountPosting('Expenses:Groceries', amt(value, 'CHF')),
          accountPosting('Assets:Bank', amt(`-${value}`, 'CHF')),
        ]);
      }
      expectedTransactions++;
    } else if (mod < 14) {
      // Price conversion transaction
      const usd = (step % 50) + 10;
      const rate = (0.9 + (step % 10) * 0.01).toFixed(2);
      const chfCents = Math.round(usd * Number(rate) * 100);
      bankChfCents -= chfCents;
      b.addTransaction(day, `FX conversion #${step}`, [
        accountPosting('Assets:Bank', amt(usd, 'USD'), {
          priceSpec: { kind: 'per-unit', amount: amt(rate, 'CHF') },
        }),
        accountPosting('Assets:Bank', null),
      ]);
      expectedTransactions++;
    } else if (mod === 14 || mod === 15) {
      // Buy VT lot at cost
      const { date, dateSpec } = makeDate(day);
      const unitPrice = 100 + (step % 30);
      vtUnits += 10;
      b.addTransaction(day, `Buy VT lot #${step}`, [
        accountPosting('Assets:Brokerage', amt(10, 'VT'), {
          costSpec: costAugment(amt(unitPrice, 'USD'), date, dateSpec, [
            `lot-${step % 5}`,
          ]),
        }),
        accountPosting('Assets:Bank', null),
      ]);
      expectedTransactions++;
    } else if (mod === 16 && vtUnits >= 10) {
      // Sell VT lot via FIFO + named account-choice rule
      const proceeds = 10 * (115 + (step % 20));
      vtUnits -= 10;
      b.addTransaction(day, `Sell VT lot #${step}`, [
        accountPosting('Assets:Brokerage', amt(-10, 'VT'), {
          costSpec: costReduce(),
        }),
        accountPosting('Assets:Bank', amt(proceeds, 'USD')),
        choicePosting({ type: 'ref', name: 'cap-gains' }),
      ]);
      expectedTransactions++;
    } else if (mod === 17 || mod === 18) {
      // Market price directive
      b.addPrice(day, 'VT', amt(105 + (step % 40), 'USD'));
    } else {
      // Periodic balance assertion on Assets:Bank CHF
      b.addBalance(day, [
        {
          account: 'Assets:Bank',
          amount: amt((bankChfCents / 100).toFixed(2), 'CHF'),
        },
      ]);
    }

    step++;
  }

  return { ledger: b.build(), expectedTransactions };
}

function buildSimplePostingsLedger(txCount: number): {
  ledger: Ledger;
  expectedTransactions: number;
} {
  const b = createStandardBuilder();
  for (let i = 0; i < txCount; i++) {
    const val = ((i % 200) + 1.25).toFixed(2);
    b.addTransaction(1 + Math.floor(i / 5), `Simple #${i}`, [
      accountPosting('Expenses:Groceries', amt(val, 'CHF')),
      accountPosting('Assets:Bank', null),
    ]);
  }
  return { ledger: b.build(), expectedTransactions: txCount };
}

function buildPriceConversionsLedger(txCount: number): {
  ledger: Ledger;
  expectedTransactions: number;
} {
  const b = createStandardBuilder();
  for (let i = 0; i < txCount; i++) {
    const qty = (i % 100) + 1;
    const rate = (0.85 + (i % 20) * 0.01).toFixed(4);
    b.addTransaction(1 + Math.floor(i / 4), `FX #${i}`, [
      accountPosting('Assets:Bank', amt(qty, 'USD'), {
        priceSpec: { kind: 'per-unit', amount: amt(rate, 'CHF') },
      }),
      accountPosting('Assets:Bank', null),
    ]);
  }
  return { ledger: b.build(), expectedTransactions: txCount };
}

function buildLotReductionLedger(
  pairs: number,
  method: 'fifo' | 'lifo',
): { ledger: Ledger; expectedTransactions: number } {
  const b = createStandardBuilder([['booking-method', method]]);
  let expectedTransactions = 0;

  // Build an initial inventory cushion of 30 lots before alternating buys/sells.
  for (let i = 0; i < 30; i++) {
    const day = 1 + i;
    const { date, dateSpec } = makeDate(day);
    b.addTransaction(day, `Seed lot #${i}`, [
      accountPosting('Assets:Brokerage', amt(10, 'VT'), {
        costSpec: costAugment(amt(95 + (i % 20), 'USD'), date, dateSpec, [
          `tag-${i % 3}`,
        ]),
      }),
      accountPosting('Assets:Bank', null),
    ]);
    expectedTransactions++;
  }

  for (let i = 0; i < pairs; i++) {
    const buyDay = 31 + i * 2;
    const { date, dateSpec } = makeDate(buyDay);
    b.addTransaction(buyDay, `Buy #${i}`, [
      accountPosting('Assets:Brokerage', amt(10, 'VT'), {
        costSpec: costAugment(amt(100 + (i % 40), 'USD'), date, dateSpec, [
          `tag-${i % 3}`,
        ]),
      }),
      accountPosting('Assets:Bank', null),
    ]);
    expectedTransactions++;

    const sellDay = buyDay + 1;
    const filterTags = i % 4 === 0 ? [`tag-${i % 3}`] : [];
    b.addTransaction(sellDay, `Sell #${i}`, [
      accountPosting('Assets:Brokerage', amt(-10, 'VT'), {
        costSpec: costReduce({ tags: filterTags }),
      }),
      accountPosting('Assets:Bank', amt(1200 + (i % 50) * 5, 'USD')),
      accountPosting('Income:Capital-Gains:Short-Term', null),
    ]);
    expectedTransactions++;
  }

  return { ledger: b.build(), expectedTransactions };
}

function buildAccountChoiceLedger(cycles: number): {
  ledger: Ledger;
  expectedTransactions: number;
} {
  const b = createStandardBuilder();
  const inlineRules = capitalGainsRules();
  let expectedTransactions = 0;

  for (let i = 0; i < cycles; i++) {
    const buyDay = 1 + i;
    const { date, dateSpec } = makeDate(buyDay);
    b.addTransaction(buyDay, `Buy lot #${i}`, [
      accountPosting('Assets:Brokerage', amt(5, 'VT'), {
        costSpec: costAugment(amt(100 + (i % 25), 'USD'), date, dateSpec, [
          i % 2 === 0 ? 'espp' : 'rsu',
        ]),
      }),
      accountPosting('Assets:Bank', null),
    ]);
    expectedTransactions++;

    const sellDay = buyDay + (i % 2 === 0 ? 400 : 120);
    const proceeds = i % 3 === 0 ? 450 : 650;
    const choice: AccountChoicePosting['account'] =
      i % 2 === 0
        ? { type: 'ref', name: 'cap-gains' }
        : { type: 'inline', rules: inlineRules };

    b.addTransaction(sellDay, `Sell with rule #${i}`, [
      accountPosting('Assets:Brokerage', amt(-5, 'VT'), {
        costSpec: costReduce(),
      }),
      accountPosting('Assets:Bank', amt(proceeds, 'USD')),
      choicePosting(choice),
    ]);
    expectedTransactions++;
  }

  return { ledger: b.build(), expectedTransactions };
}

function buildBalanceAssertionsLedger(count: number): {
  ledger: Ledger;
  expectedTransactions: number;
} {
  const b = createStandardBuilder();
  let running = 0;
  for (let i = 0; i < count; i++) {
    const day = 1 + i;
    const { date, dateSpec } = makeDate(day);
    running += 1;
    b.addTransaction(day, `Add lot #${i}`, [
      accountPosting('Assets:Brokerage', amt(1, 'VT'), {
        costSpec: costAugment(amt(100 + (i % 50), 'USD'), date, dateSpec),
      }),
      accountPosting('Assets:Bank', null),
    ]);
    b.addBalance(day, [
      { account: 'Assets:Brokerage', amount: amt(running, 'VT') },
    ]);
  }
  return { ledger: b.build(), expectedTransactions: count };
}

function buildOpenLotsScalingLedger(
  openLotCount: number,
  reductions: number,
): { ledger: Ledger; expectedTransactions: number } {
  const b = createStandardBuilder();
  let expectedTransactions = 0;

  for (let i = 0; i < openLotCount; i++) {
    const day = 1 + i;
    const { date, dateSpec } = makeDate(day);
    b.addTransaction(day, `Open lot #${i}`, [
      accountPosting('Assets:Brokerage', amt(10, 'VT'), {
        costSpec: costAugment(amt(100 + (i % 100), 'USD'), date, dateSpec),
      }),
      accountPosting('Assets:Bank', null),
    ]);
    expectedTransactions++;
  }

  for (let i = 0; i < reductions; i++) {
    const day = 1 + openLotCount + i;
    b.addTransaction(day, `Partial reduction #${i}`, [
      accountPosting('Assets:Brokerage', amt(-1, 'VT'), {
        costSpec: costReduce(),
      }),
      accountPosting('Assets:Bank', amt(130, 'USD')),
      accountPosting('Income:Capital-Gains:Short-Term', null),
    ]);
    expectedTransactions++;
  }

  return { ledger: b.build(), expectedTransactions };
}

function buildManyAccountsLedger(
  accountCount: number,
  txCount: number,
): { ledger: Ledger; expectedTransactions: number } {
  const b = new LedgerBuilder();
  b.addCurrency('CHF', 0);
  b.openAccount('Assets:Bank', 0);
  const expenseAccounts: string[] = [];
  for (let i = 0; i < accountCount; i++) {
    const name = `Expenses:Category-${i}`;
    expenseAccounts.push(name);
    b.openAccount(name, 0);
  }
  for (let i = 0; i < txCount; i++) {
    const acc = expenseAccounts[i % accountCount];
    b.addTransaction(1 + Math.floor(i / 5), `Tx #${i}`, [
      accountPosting(acc, amt(10, 'CHF')),
      accountPosting('Assets:Bank', null),
    ]);
  }
  return { ledger: b.build(), expectedTransactions: txCount };
}

function buildWideTransactionsLedger(
  txCount: number,
  postingsPerTx: number,
): { ledger: Ledger; expectedTransactions: number } {
  const b = createStandardBuilder();
  const targets = [
    'Expenses:Groceries',
    'Expenses:Household:Rent',
    'Expenses:Misc',
  ];
  for (let i = 0; i < txCount; i++) {
    const postings: Posting[] = [];
    for (let p = 0; p < postingsPerTx - 1; p++) {
      postings.push(accountPosting(targets[p % targets.length], amt(5, 'CHF')));
    }
    postings.push(accountPosting('Assets:Bank', null));
    b.addTransaction(1 + i, `Wide tx #${i}`, postings);
  }
  return { ledger: b.build(), expectedTransactions: txCount };
}

function makeBookCase(
  id: string,
  group: BookingGroup,
  description: string,
  built: { readonly ledger: Ledger; readonly expectedTransactions: number },
  options?: { readonly heavy?: boolean },
): BenchCase {
  const { ledger, expectedTransactions } = built;
  const directiveCount = ledger.directives.length;
  return {
    id,
    group,
    description,
    work: { dirs: directiveCount },
    heavy: options?.heavy,
    run: () => {
      const res = book(ledger);
      if (E.isLeft(res)) {
        throw new Error(`Case "${id}" failed to book: ${res.left.message}`);
      }
      if (res.right.transactions.length !== expectedTransactions) {
        throw new Error(
          `Case "${id}" expected ${expectedTransactions} transactions, got ${res.right.transactions.length}`,
        );
      }
      return res.right.transactions.length;
    },
  };
}

export function createSuite(): BenchSuite {
  return {
    name: 'booking',
    cases: [
      makeBookCase(
        'mixed-5k',
        'mixed',
        'Realistic mixed ledger (5,000 directives)',
        buildMixedLedger(5_000),
      ),
      makeBookCase(
        'mixed-50k',
        'mixed',
        'Realistic mixed ledger (50,000 directives)',
        buildMixedLedger(50_000),
        { heavy: true },
      ),

      makeBookCase(
        'simple-postings',
        'workload',
        'Simple 2-posting transactions with interpolation (3k)',
        buildSimplePostingsLedger(3_000),
      ),
      makeBookCase(
        'price-conversions',
        'workload',
        'Multi-currency @ price conversions (2k)',
        buildPriceConversionsLedger(2_000),
      ),
      makeBookCase(
        'fifo-lots',
        'workload',
        'FIFO lot augmentations and filtered reductions (500 buy/sell pairs)',
        buildLotReductionLedger(500, 'fifo'),
      ),
      makeBookCase(
        'lifo-lots',
        'workload',
        'LIFO lot augmentations and filtered reductions (500 buy/sell pairs)',
        buildLotReductionLedger(500, 'lifo'),
      ),
      makeBookCase(
        'account-choice',
        'workload',
        'Lot reductions with named & inline account-choice rules (500 cycles)',
        buildAccountChoiceLedger(500),
      ),
      makeBookCase(
        'balance-assertions',
        'workload',
        'Balance assertions over growing multi-lot inventory (500 lots)',
        buildBalanceAssertionsLedger(500),
      ),

      makeBookCase(
        'scale-lots-100',
        'scaling',
        '100 open lots + 200 FIFO partial reductions',
        buildOpenLotsScalingLedger(100, 200),
      ),
      makeBookCase(
        'scale-lots-1000',
        'scaling',
        '1,000 open lots + 200 FIFO partial reductions',
        buildOpenLotsScalingLedger(1_000, 200),
      ),
      makeBookCase(
        'scale-accounts-20',
        'scaling',
        '2,000 transactions across 20 accounts',
        buildManyAccountsLedger(20, 2_000),
      ),
      makeBookCase(
        'scale-accounts-500',
        'scaling',
        '2,000 transactions across 500 accounts',
        buildManyAccountsLedger(500, 2_000),
      ),
      makeBookCase(
        'scale-postings-5',
        'scaling',
        '400 transactions x 5 postings',
        buildWideTransactionsLedger(400, 5),
      ),
      makeBookCase(
        'scale-postings-50',
        'scaling',
        '40 transactions x 50 postings',
        buildWideTransactionsLedger(40, 50),
      ),
    ],
    scalingChecks: [
      {
        id: 'mixed-ledger-size',
        label: 'Mixed ledger size (5k -> 50k directives)',
        smallId: 'mixed-5k',
        largeId: 'mixed-50k',
        sizeRatio: 10,
        // Accumulating open lots over 50k directives causes ~1.5x normalized
        // scaling during FIFO reductions.
        maxNormalizedRatio: 2.5,
      },
      {
        id: 'open-lot-depth',
        label: 'Open lot inventory depth (100 -> 1,000 lots)',
        smallId: 'scale-lots-100',
        largeId: 'scale-lots-1000',
        sizeUnit: 'dirs',
        maxNormalizedRatio: 2.0,
      },
      {
        id: 'account-count',
        label: 'Account count scaling (20 -> 500 accounts, same 2k txns)',
        smallId: 'scale-accounts-20',
        largeId: 'scale-accounts-500',
        sizeRatio: 1,
        maxNormalizedRatio: 2.0,
      },
      {
        id: 'wide-transactions',
        label: 'Postings per transaction (5 -> 50 postings)',
        smallId: 'scale-postings-5',
        largeId: 'scale-postings-50',
        sizeRatio: 1,
        maxNormalizedRatio: 2.0,
      },
    ],
  };
}
