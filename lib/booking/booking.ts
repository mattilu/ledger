import { ExactNumber, ExactNumberType } from 'exactnumber';
import { either as E, function as F, readonlyArray as RA } from 'fp-ts';
import { Map as ImmutableMap } from 'immutable';

import { Amount } from '../core/amount.js';
import { CanonicalAmountConverter } from '../core/sign-convention.js';
import { Directive, DirectiveCommon } from '../loading/directive.js';
import { AccountRuleDirective } from '../loading/directives/account-choice.js';
import { CurrencyDirective } from '../loading/directives/currency.js';
import { PriceDirective } from '../loading/directives/price.js';
import {
  AccountChoice,
  AccountChoicePosting,
  AccountPosting,
  CostSpec,
  Posting,
  PriceSpec,
  TransactionDirective,
} from '../loading/directives/transaction.js';
import { AccountMap, AccountMapValue, Ledger } from '../loading/ledger.js';
import { Metadata } from '../loading/metadata.js';
import { SourceContext } from '../loading/source-context.js';
import { DateSpec } from '../parsing/spec/date.js';
import { Formatter } from '../utils/formatting.js';
import { Cost } from './cost.js';
import { BookingError } from './error.js';
import {
  AccountChoiceEvaluator,
  compileAccountChoiceRules,
} from './internal/account-choice.js';
import { BookingMethod } from './internal/booking-method.js';
import { FIFO } from './internal/fifo.js';
import { LIFO } from './internal/lifo.js';
import { Inventory, InventoryMap } from './inventory.js';
import { BookedLedger } from './ledger.js';
import { Position } from './position.js';
import { BookedPosting, Transaction } from './transaction.js';

const ZERO = ExactNumber(0);

/**
 * Runs booking logic, transforming a Ledger to a BookedLedger.
 *
 * @param ledger Ledger containing directives to evaluate.
 * @returns A BookedLedger, or a BookingError in case of failure.
 */
export function book(ledger: Ledger): E.Either<BookingError, BookedLedger> {
  const transactions: Transaction[] = [];
  const prices: PriceDirective[] = [];
  let accountMap: AccountMap = ImmutableMap();
  const currencyMap = ledger.currencyMap;
  let inventories: InventoryMap = ImmutableMap();
  const converter = new CanonicalAmountConverter({
    get(account) {
      return accountMap.get(account)?.open?.normalBalanceSide;
    },
  });
  const compiledAccountRules = new Map<string, AccountChoiceEvaluator>();

  for (const directive of ledger.directives) {
    switch (directive.type) {
      case 'balance': {
        for (const balance of directive.balances) {
          const accountCheck = checkValidAccount(
            accountMap,
            directive.optionMap,
            balance.account,
            // Checking balance of a closed account is fine. Maybe later we can
            // optionally add an implicit check that it's empty at close.
            { allowClosed: true },
          );
          if (E.isLeft(accountCheck)) {
            return E.left(enrichError(accountCheck.left, directive));
          }

          const inventory = inventories.get(balance.account, Inventory.Empty);
          const amount = inventory
            .getPositionsForCurrency(balance.amount.currency)
            .reduce(
              (acc, v) => acc.add(v.amount),
              Amount.zero(balance.amount.currency),
            );
          const delta = balance.amount.sub(amount);
          const maxDelta = new Amount(
            balance.approx?.abs() ?? ZERO,
            balance.amount.currency,
          );
          if (delta.abs().gt(maxDelta)) {
            const formatter = new Formatter({ currencyMap });
            const fromCanonicalAmount = converter.getConvertFn(
              directive.signConvention,
              balance.account,
            );

            let msg = `Balance for ${balance.account} does not match.
Expected: ${formatter.formatAmount(fromCanonicalAmount(balance.amount))}
Actual: ${formatter.formatAmount(fromCanonicalAmount(amount))}
Delta: ${formatter.formatAmount(fromCanonicalAmount(delta))}`;
            if (!maxDelta.isZero()) {
              msg += `\nMaxDelta: ${formatter.formatAmount(maxDelta)}`;
            }
            return E.left(new BookingError(msg, directive));
          }
        }
        break;
      }
      case 'close': {
        const accountCheck = checkValidAccount(
          accountMap,
          directive.optionMap,
          directive.account,
          // Don't fail if closed, so we can provide a better error message.
          { allowClosed: true },
        );
        if (E.isLeft(accountCheck)) {
          return E.left(enrichError(accountCheck.left, directive));
        }
        if (accountCheck.right.close) {
          return E.left(
            new BookingError(
              `Account ${directive.account} is already closed (at ` +
                `${formatSourceContext(accountCheck.right.close.srcCtx)})`,
              directive,
            ),
          );
        }
        accountMap = directive.accountMap;
        // Note: no need to clear the cache here, closing cannot alter the
        // normal-balance side.
        break;
      }
      case 'open': {
        // Note: reopening a closed account is allowed.
        const account = accountMap.get(directive.account, null);
        if (account?.open && !account.close) {
          return E.left(
            new BookingError(
              `Account ${directive.account} is already open (at ` +
                `${formatSourceContext(account.open.srcCtx)})`,
              directive,
            ),
          );
        }
        accountMap = directive.accountMap;
        converter.clearCache();
        break;
      }
      case 'price': {
        prices.push(directive);
        break;
      }
      case 'transaction': {
        const got = bookTransaction(
          directive,
          inventories,
          accountMap,
          currencyMap,
          ledger.accountRuleMap,
          compiledAccountRules,
          converter,
        );
        if (E.isLeft(got)) {
          return E.left(enrichError(got.left, directive));
        }

        const { transaction, priceDirectives } = got.right;

        transactions.push(transaction);
        inventories = transaction.inventoriesAfter;

        prices.push(...priceDirectives);
        break;
      }
      default: {
        const d = directive as DirectiveCommon<string>;
        return E.left(
          new BookingError(
            `${d.type} directive not implemented yet`,
            directive,
          ),
        );
      }
    }
  }

  return E.right({
    transactions,
    prices,
    accountMap,
    currencyMap,
    inventories,
    signConvention: ledger.signConvention,
  });
}

function checkValidAccount(
  accountMap: AccountMap,
  optionMap: ImmutableMap<string, string>,
  account: string,
  options?: { allowClosed: boolean },
): E.Either<Error, AccountMapValue> {
  const state = accountMap.get(account, null);
  const referenceChecksMode = optionMap.get(
    'account-reference-checks',
    'lenient',
  );

  const validModes = ['none', 'lenient', 'strict'];
  if (validModes.indexOf(referenceChecksMode) === -1) {
    return E.left(
      new Error(
        `Invalid account-reference-checks mode: ${referenceChecksMode}, ` +
          `expected one of ${validModes.join(', ')}`,
      ),
    );
  }

  if (referenceChecksMode === 'none') {
    return E.right(state ?? {});
  }

  if (state?.close && !(options?.allowClosed ?? false)) {
    return E.left(
      new Error(
        `Account ${account} has been closed ` +
          `(at ${formatSourceContext(state.close.srcCtx)})`,
      ),
    );
  }

  if (state === null && referenceChecksMode === 'strict') {
    return E.left(new Error(`Account ${account} has not been opened`));
  }

  return E.right(state ?? {});
}

function enrichError(error: Error, directive: Directive) {
  return new BookingError(error.message, directive, { cause: error });
}

interface LotReduction {
  readonly amount: Amount;
  readonly sourceAccount: string;
  readonly cost: Cost;
}

interface LotReductionGroup {
  readonly reductions: readonly LotReduction[];
  readonly proceeds: Amount[];
}

interface AccountChoiceAggregatePortion {
  readonly context: 'aggregate';
  readonly amount: Amount;
}

interface AccountChoiceReductionPortion {
  readonly context: 'reduction';
  readonly amount: Amount;
  readonly sourceAccount: string;
  readonly holdingPeriod: ExactNumberType;
}

type AccountChoicePortion =
  | AccountChoiceAggregatePortion
  | AccountChoiceReductionPortion;

interface BookTransactionResult {
  readonly transaction: Transaction;
  readonly priceDirectives: readonly PriceDirective[];
}

function bookTransaction(
  transaction: TransactionDirective,
  inventories: InventoryMap,
  accountMap: AccountMap,
  currencyMap: ImmutableMap<string, CurrencyDirective>,
  accountRuleMap: ImmutableMap<string, AccountRuleDirective>,
  compiledAccountRules: Map<string, AccountChoiceEvaluator>,
  converter: CanonicalAmountConverter,
): E.Either<Error, BookTransactionResult> {
  const inventoriesBefore = inventories;
  const postings: BookedPosting[] = [];
  const prices: PriceDirective[] = [];
  let activeReductionGroup: LotReductionGroup | null = null;
  let pendingReductionGroups: LotReductionGroup[] = [];
  let pendingReductionPortions: AccountChoiceReductionPortion[] = [];
  let balance = Inventory.Empty;

  function finishReductionGroup() {
    if (activeReductionGroup !== null) {
      pendingReductionGroups.push(activeReductionGroup);
      activeReductionGroup = null;
    }
  }

  for (const posting of transaction.postings) {
    if (isAccountChoicePosting(posting)) {
      const accountChoiceResult = F.pipe(
        resolveAccountChoiceRules(
          posting.account,
          accountRuleMap,
          compiledAccountRules,
        ),
        E.flatMap(({ selectAccount, accountRule }) => {
          finishReductionGroup();
          const reductionPortions = [
            ...pendingReductionPortions,
            ...pendingReductionGroups.flatMap(group =>
              makeLotPortions(group, transaction.date),
            ),
          ];
          pendingReductionGroups = [];
          return F.pipe(
            bookAccountChoice(
              posting,
              selectAccount,
              inventories,
              balance,
              converter,
              reductionPortions,
            ),
            E.tap(result => {
              inventories = result.inventories;
              balance = result.balance;
              pendingReductionPortions = result.unmatchedReductionPortions;
              postings.push(...result.postings);
              return validateBookedPostings(
                result.postings,
                accountMap,
                transaction,
                currencyMap,
              );
            }),
            accountRule !== null
              ? E.mapLeft(err => enrichAccountRuleError(err, accountRule))
              : F.identity,
          );
        }),
      );
      if (E.isLeft(accountChoiceResult)) {
        return accountChoiceResult;
      }
      continue;
    }

    if (posting.costSpec !== null || posting.priceSpec !== null) {
      finishReductionGroup();
    }

    const bookPostingResult = F.pipe(
      checkValidAccount(accountMap, transaction.optionMap, posting.account),
      E.flatMap(accountMapValue =>
        bookPosting(
          transaction,
          posting,
          inventories,
          balance,
          accountMapValue,
          converter,
        ),
      ),
      E.tap(bookResult => {
        inventories = bookResult.inventories;
        balance = bookResult.balance;
        if (bookResult.lotReductions.length > 0) {
          finishReductionGroup();
          activeReductionGroup = {
            reductions: bookResult.lotReductions,
            proceeds: [],
          };
        } else if (posting.amount !== null && activeReductionGroup !== null) {
          activeReductionGroup.proceeds.push(posting.amount);
        }
        postings.push(...bookResult.postings);
        prices.push(...bookResult.priceDirectives);
        if (posting.amount === null) {
          activeReductionGroup = null;
          pendingReductionGroups = [];
          pendingReductionPortions = [];
        }
        return validateBookedPostings(
          bookResult.postings,
          accountMap,
          transaction,
          currencyMap,
        );
      }),
    );
    if (E.isLeft(bookPostingResult)) {
      return bookPostingResult;
    }
  }

  if (!balance.isEmpty()) {
    return E.left(
      new Error(`Transaction does not balance. Residual:\n${balance}`),
    );
  }

  return E.right({
    transaction: {
      date: transaction.date,
      description: transaction.description,
      flag: transaction.flag,
      postings,
      meta: transaction.meta,
      signConvention: transaction.signConvention,
      inventoriesBefore,
      inventoriesAfter: inventories,
      srcCtx: transaction.srcCtx,
    },
    priceDirectives: prices,
  });
}

function isAccountChoicePosting(
  posting: Posting,
): posting is AccountChoicePosting {
  return typeof posting.account !== 'string';
}

function validateBookedPostings(
  postings: readonly BookedPosting[],
  accountMap: AccountMap,
  transaction: TransactionDirective,
  currencyMap: ImmutableMap<string, CurrencyDirective>,
): E.Either<Error, void> {
  return F.pipe(
    postings,
    RA.traverse(E.Applicative)(posting =>
      F.pipe(
        checkValidAccount(accountMap, transaction.optionMap, posting.account),
        E.flatMap(accountMapValue => {
          const allowedCurrencies = accountMapValue.open?.currencies ?? [];
          if (
            allowedCurrencies.length > 0 &&
            !allowedCurrencies.includes(posting.amount.currency)
          ) {
            const formatter = new Formatter({ currencyMap });
            return E.left(
              new Error(
                `Cannot post ${formatter.formatAmount(posting.amount)} to account ${posting.account}: currency ${posting.amount.currency} not allowed`,
              ),
            );
          }
          return E.of(undefined);
        }),
      ),
    ),
    E.asUnit,
  );
}

interface ResolvedAccountChoice {
  readonly selectAccount: AccountChoiceEvaluator;
  readonly accountRule: AccountRuleDirective | null;
}

function resolveAccountChoiceRules(
  choice: AccountChoice,
  accountRuleMap: ImmutableMap<string, AccountRuleDirective>,
  compiledAccountRules: Map<string, AccountChoiceEvaluator>,
): E.Either<Error, ResolvedAccountChoice> {
  if (choice.type === 'inline') {
    return F.pipe(
      compileAccountChoiceRules(choice.rules),
      E.map(selectAccount => ({ selectAccount, accountRule: null })),
    );
  }

  const accountRule = accountRuleMap.get(choice.name);
  if (accountRule === undefined) {
    return E.left(new Error(`Account rule '${choice.name}' is not defined`));
  }

  const cached = compiledAccountRules.get(choice.name);
  if (cached !== undefined) {
    return E.right({ selectAccount: cached, accountRule });
  }

  return F.pipe(
    compileAccountChoiceRules(accountRule.rules),
    E.bimap(
      err => enrichAccountRuleError(err, accountRule),
      selectAccount => {
        compiledAccountRules.set(choice.name, selectAccount);
        return { selectAccount, accountRule };
      },
    ),
  );
}

function enrichAccountRuleError(
  error: Error,
  accountRule: AccountRuleDirective,
): Error {
  return new Error(
    `In account rule '${accountRule.name}' (defined at ` +
      `${formatSourceContext(accountRule.srcCtx)}): ${error.message}`,
    { cause: error },
  );
}

interface BookAccountChoiceResult {
  readonly postings: readonly BookedPosting[];
  readonly inventories: InventoryMap;
  readonly balance: Inventory;
  readonly unmatchedReductionPortions: AccountChoiceReductionPortion[];
}

function bookAccountChoice(
  posting: AccountChoicePosting,
  selectAccount: AccountChoiceEvaluator,
  inventories: InventoryMap,
  balance: Inventory,
  converter: CanonicalAmountConverter,
  portions: readonly AccountChoicePortion[],
): E.Either<Error, BookAccountChoiceResult> {
  const bookedPostings: BookedPosting[] = [];
  const unmatchedReductionPortions: AccountChoiceReductionPortion[] = [];

  return F.pipe(
    [...portions, ...makeBalanceResidualPortions(balance, portions)],
    RA.traverse(E.Applicative)(portion =>
      F.pipe(
        selectAccount({
          direction: portion.amount.isPos() ? 'debit' : 'credit',
          ...portion,
        }),
        E.map(account => {
          if (account !== null) {
            bookedPostings.push({
              account,
              flag: posting.flag,
              amount: portion.amount,
              cost: null,
              meta: posting.meta,
              normalBalanceSide: converter.getNormalBalanceSide(account),
            });
          } else if (portion.context === 'reduction') {
            unmatchedReductionPortions.push(portion);
          }
        }),
      ),
    ),
    E.map(() => ({
      ...doBook(inventories, balance, ...bookedPostings),
      unmatchedReductionPortions,
    })),
  );
}

function makeBalanceResidualPortions(
  balance: Inventory,
  portions: readonly AccountChoicePortion[],
): AccountChoiceAggregatePortion[] {
  return balance
    .addAmounts(portions.map(portion => portion.amount))
    .getPositions()
    .map(position => ({
      amount: position.amount.neg(),
      context: 'aggregate',
    }));
}

function makeLotPortions(
  group: LotReductionGroup,
  reductionDate: Date,
): AccountChoicePortion[] {
  if (group.reductions.length === 0) {
    return [];
  }

  const totalUnitsByCostCurrency = new Map<string, ExactNumberType>();
  for (const reduction of group.reductions) {
    for (const cost of reduction.cost.amounts) {
      const current = totalUnitsByCostCurrency.get(cost.currency) ?? ZERO;
      totalUnitsByCostCurrency.set(
        cost.currency,
        current.add(reduction.amount.amount),
      );
    }
  }

  const totalProceeds = Inventory.Empty.addAmounts(group.proceeds);
  const portions: AccountChoicePortion[] = [];

  for (const reduction of group.reductions) {
    for (const cost of reduction.cost.amounts) {
      const totalUnits = totalUnitsByCostCurrency.get(cost.currency) ?? ZERO;
      if (totalUnits.isZero()) {
        continue;
      }
      const unitShare = reduction.amount.amount.div(totalUnits);
      const totalProceedsForCurrency =
        totalProceeds.getPositionsForCurrency(cost.currency)?.[0]?.amount ??
        Amount.zero(cost.currency);
      const allocatedProceeds = totalProceedsForCurrency.mul(unitShare);
      const costBasis = cost.mul(reduction.amount.amount);
      const inferredAmount = allocatedProceeds.add(costBasis);
      if (inferredAmount.isZero()) {
        continue;
      }
      const elapsedMilliseconds =
        reductionDate.getTime() - reduction.cost.date.getTime();
      portions.push({
        context: 'reduction',
        amount: inferredAmount.neg(),
        sourceAccount: reduction.sourceAccount,
        holdingPeriod: ExactNumber(elapsedMilliseconds).div(86_400_000),
      });
    }
  }

  return portions;
}

interface BookPostingResult {
  readonly postings: readonly BookedPosting[];
  readonly inventories: InventoryMap;
  readonly balance: Inventory;
  readonly lotReductions: readonly LotReduction[];
  readonly priceDirectives: readonly PriceDirective[];
}

function bookPosting(
  transaction: TransactionDirective,
  posting: AccountPosting,
  inventories: InventoryMap,
  balance: Inventory,
  accountMapValue: AccountMapValue,
  converter: CanonicalAmountConverter,
): E.Either<Error, BookPostingResult> {
  if (posting.costSpec !== null) {
    if (posting.amount === null) {
      return E.left(
        new Error(`Amount interpolation with cost spec is invalid`),
      );
    }

    const tradingAccount = getTradingAccount(
      transaction,
      posting,
      accountMapValue,
    );
    const tradingAccountNormalBalanceSide =
      converter.getNormalBalanceSide(tradingAccount);

    if (posting.costSpec.amounts.length > 0) {
      // Both cost and amount are known. We increase the account by the amount
      // at-cost, and post the opposite amount to the trading account. This
      // leaves the amount of the cost in the running balance, which is usually
      // balanced with a posting without amount.
      //
      // Example:
      //
      // 2025-04-01 * "Open Long"
      //   Assets:Broker 2 VT {{ 300 CHF }}
      //   Assets:Broker
      //
      //  ->
      //
      // 2025-04-01 * "Open Long"
      //   Assets:Broker    2 VT { 150 CHF }
      //   Trading:Default -2 VT
      //   Trading:Default  300 CHF
      //   Assets:Broker ; -300 CHF, inferred
      const postingAmount = posting.amount;
      const costSpec = posting.costSpec;
      return F.pipe(
        validateCostSpecForAugmentation(costSpec),
        E.let(
          'cost',
          () =>
            new Cost(
              costSpec.amounts.map(amount =>
                getPerUnitAmount(amount, postingAmount, costSpec.kind),
              ),
              costSpec.dates.length === 1
                ? costSpec.dates[0]
                : transaction.date,
              costSpec.dateSpecs.length === 1
                ? costSpec.dateSpecs[0]
                : transaction.dateSpec,
              costSpec.tags,
            ),
        ),
        E.map(({ cost }) => {
          const result = doBook(
            inventories,
            balance,
            {
              account: posting.account,
              flag: posting.flag,
              amount: postingAmount,
              cost,
              meta: posting.meta,
              normalBalanceSide: posting.normalBalanceSide,
            },
            {
              account: tradingAccount,
              flag: posting.flag,
              amount: postingAmount.neg(),
              cost: null,
              meta: ImmutableMap(),
              normalBalanceSide: tradingAccountNormalBalanceSide,
            },
            ...costSpec.amounts.map(amount => ({
              account: tradingAccount,
              flag: posting.flag,
              amount: getTotalAmount(amount, postingAmount, costSpec.kind),
              cost: null,
              meta: ImmutableMap() as Metadata,
              normalBalanceSide: tradingAccountNormalBalanceSide,
            })),
          );
          return {
            ...result,
            lotReductions: [],
            priceDirectives: makePriceDirectives(
              transaction,
              postingAmount,
              posting.priceSpec,
              cost,
            ),
          };
        }),
      );
    }

    // Amount is known, but cost is not. We treat this as a reduction, and
    // invoke the booking method.
    //
    // Example (assuming the open position from previous example):
    //
    // 2025-04-02 * "Close Long"
    //   Assets:Broker  -2 VT {}
    //   Assets:Broker 350 CHF
    //   Income:Trading
    //
    //  ->
    //
    // 2025-04-02 * "Close Long"
    //   Assets:Broker     -2 VT { 150 CHF }
    //   Trading:Default    2 VT
    //   Trading:Default -300 CHF
    //   Assets:Broker    350 CHF
    //   Income:Trading ; -50 CHF, inferred

    const [inventoryUsable, inventoryRest] = filterInventoryForReduction(
      inventories.get(posting.account) ?? Inventory.Empty,
      posting.costSpec,
    );

    const postingAmount = posting.amount;
    const bookResult = F.pipe(
      getBookingMethod(transaction, posting, accountMapValue),
      E.flatMap(bookingMethod =>
        bookingMethod.book(
          posting.account,
          posting.flag,
          posting.meta,
          postingAmount,
          inventoryUsable,
        ),
      ),
    );
    if (E.isLeft(bookResult)) {
      return bookResult;
    }

    const lotReductions = bookResult.right[0]
      .filter(posting => posting.cost !== null)
      .map(posting => ({
        amount: posting.amount,
        sourceAccount: posting.account,
        cost: posting.cost!,
      }));

    const postings: BookedPosting[] = [];
    for (const posting of bookResult.right[0]) {
      const {
        postings: postings1,
        inventories: newInventories,
        balance: newBalance,
      } = doBook(
        inventories,
        balance,
        // Post the reduction as we got it from the booking method, e.g.
        //
        // Assets:Broker    -60 USD { 1.2 CHF }
        //
        {
          ...posting,
          normalBalanceSide: converter.getNormalBalanceSide(posting.account),
        },
        // Additonally, post the amount, negated, and the total cost, to the
        // trading accounts, e.g.
        //
        // Trading:Default   60 USD
        // Trading:Default  -72 CHF  ; 60 USD * 1.2 CHF/USD
        //
        // And if we got 80 CHF for the sale, then our PnL would be 8 CHF:
        //
        //   Assets:Broker   -60 USD { 1.2 CHF }
        //   Trading:Default  60 USD
        //   Trading:Default -72 CHF
        //   Assets:Broker    80 CHF
        //   Income:Trading ; -8 CHF, inferred
        //
        {
          account: tradingAccount,
          flag: posting.flag,
          amount: posting.amount.neg(),
          cost: null,
          meta: ImmutableMap(),
          normalBalanceSide: tradingAccountNormalBalanceSide,
        },
        ...(posting.cost?.amounts ?? []).map(cost => ({
          account: tradingAccount,
          flag: posting.flag,
          amount: cost.mul(posting.amount.amount),
          cost: null,
          meta: ImmutableMap() as Metadata,
          normalBalanceSide: tradingAccountNormalBalanceSide,
        })),
      );
      inventories = newInventories;
      balance = newBalance;
      postings.push(...postings1);
    }

    // Overwrite the inventory for the account with the result from the
    // booking method, as it could apply different changes, like averaging
    // cost of positions.
    inventories = inventories.set(
      posting.account,
      mergeInventories(inventoryRest, bookResult.right[1]),
    );

    return E.right({
      postings,
      inventories,
      balance,
      lotReductions,
      priceDirectives: [],
    });
  }

  if (posting.priceSpec !== null) {
    if (posting.amount === null) {
      return E.left(
        new Error(`Amount interpolation with price spec is invalid`),
      );
    }

    const tradingAccount = getTradingAccount(
      transaction,
      posting,
      accountMapValue,
    );
    const tradingAccountNormalBalanceSide =
      converter.getNormalBalanceSide(tradingAccount);

    // Similar to the cost case, but here we don't hold the position at cost.
    return E.right({
      ...doBook(
        inventories,
        balance,
        {
          account: posting.account,
          flag: posting.flag,
          amount: posting.amount,
          cost: null,
          meta: posting.meta,
          normalBalanceSide: posting.normalBalanceSide,
        },
        {
          account: tradingAccount,
          flag: posting.flag,
          amount: posting.amount.neg(),
          cost: null,
          meta: ImmutableMap(),
          normalBalanceSide: tradingAccountNormalBalanceSide,
        },
        {
          account: tradingAccount,
          flag: posting.flag,
          amount: getTotalAmount(
            posting.priceSpec.amount,
            posting.amount,
            posting.priceSpec.kind,
          ),
          cost: null,
          meta: ImmutableMap() as Metadata,
          normalBalanceSide: tradingAccountNormalBalanceSide,
        },
      ),
      lotReductions: [],
      priceDirectives: makePriceDirectives(
        transaction,
        posting.amount,
        posting.priceSpec,
        null,
      ),
    });
  }

  if (posting.amount !== null) {
    // Posting is fully specified, we can just book it.
    return E.right({
      ...doBook(inventories, balance, {
        account: posting.account,
        flag: posting.flag,
        amount: posting.amount,
        cost: null,
        meta: posting.meta,
        normalBalanceSide: posting.normalBalanceSide,
      }),
      lotReductions: [],
      priceDirectives: [],
    });
  }

  // Posting doesn't specify amount, so we infer it to be the running balance of
  // the transaction, and balance it out.
  const balancePostings = balance.getPositions().map(
    (amount): BookedPosting => ({
      account: posting.account,
      flag: posting.flag,
      amount: amount.amount.neg(),
      cost: null,
      meta: posting.meta,
      normalBalanceSide: posting.normalBalanceSide,
    }),
  );

  return E.right({
    ...doBook(inventories, balance, ...balancePostings),
    lotReductions: [],
    priceDirectives: [],
  });
}

function validateCostSpecForAugmentation(
  costSpec: CostSpec,
): E.Either<Error, void> {
  if (costSpec.dates.length > 1 || costSpec.dateSpecs.length > 1) {
    return E.left(new Error('Augmentation cannot specify more than one date'));
  }
  if (costSpec.currencies.length > 0) {
    return E.left(new Error('Augmentation cannot specify currencies'));
  }
  return E.of(undefined);
}

function filterInventoryForReduction(
  inventory: Inventory,
  costSpec: CostSpec,
): [Inventory, Inventory] {
  const currencies = new Set(costSpec.currencies);
  const tags = new Set(costSpec.tags);
  const timestamps = new Set(costSpec.dates.map(x => x.getTime()));

  type CostPred = (cost: Cost) => boolean;

  const currencyMatch: CostPred =
    currencies.size === 0
      ? () => true
      : cost => cost.amounts.some(amount => currencies.has(amount.currency));

  const tagsMatch: CostPred =
    tags.size === 0 ? () => true : cost => cost.tags.some(tag => tags.has(tag));

  const timestampMatch: CostPred =
    timestamps.size === 0
      ? () => true
      : cost => timestamps.has(cost.date.getTime());

  // If exact timestamps don't match, we compare the date specs. This is to
  // allow filtering when timezones are involved, where the user might specify a
  // date (e.g. 2025-12-31 01:00) but actually get a timestamp on the previous
  // day UTC (e.g. 2025-12-30 23:00 Z if timzeone is +02:00).
  function dateSpecMatches(dateSpec: DateSpec, match: DateSpec) {
    if (match.time) {
      // If time is specified, always return false: in this case we want to only
      // match if the exact timestamp matches (handled by `timestampMatch`).
      return false;
    }

    return dateSpec.date === match.date;
  }

  const dateSpecMatch: CostPred =
    costSpec.dateSpecs.length === 0
      ? () => true
      : cost =>
          costSpec.dateSpecs.some(dateSpec =>
            dateSpecMatches(cost.dateSpec, dateSpec),
          );

  return partitionInventory(
    inventory,
    position =>
      position.cost !== null &&
      currencyMatch(position.cost) &&
      tagsMatch(position.cost) &&
      (timestampMatch(position.cost) || dateSpecMatch(position.cost)),
  );
}

function partitionInventory(
  inventory: Inventory,
  predicate: (position: Position) => boolean,
): [Inventory, Inventory] {
  const ok: Position[] = [];
  const ko: Position[] = [];
  for (const position of inventory.getPositions()) {
    if (predicate(position)) {
      ok.push(position);
    } else {
      ko.push(position);
    }
  }
  if (ok.length === 0) {
    return [Inventory.Empty, inventory];
  } else if (ko.length === 0) {
    return [inventory, Inventory.Empty];
  } else {
    return [Inventory.Empty.addPositions(ok), Inventory.Empty.addPositions(ko)];
  }
}

function mergeInventories(a: Inventory, b: Inventory): Inventory {
  return a.isEmpty() ? b : b.isEmpty() ? a : a.addPositions(b.getPositions());
}

interface DoBookResult {
  readonly postings: readonly BookedPosting[];
  readonly inventories: InventoryMap;
  readonly balance: Inventory;
}

function doBook(
  inventories: InventoryMap,
  balance: Inventory,
  ...postings: BookedPosting[]
): DoBookResult {
  inventories = inventories.withMutations(inventories => {
    for (const posting of postings) {
      inventories = inventories.update(posting.account, inventory =>
        (inventory ?? Inventory.Empty).addPosition(
          new Position(posting.amount, posting.cost),
        ),
      );
      balance = balance.addAmount(posting.amount);
    }
  });

  return { postings, inventories, balance };
}

function makePriceDirectives(
  transaction: TransactionDirective,
  amount: Amount,
  priceSpec: PriceSpec | null,
  cost: Cost | null,
): PriceDirective[] {
  if (priceSpec !== null) {
    return [
      {
        type: 'price',
        date: transaction.date,
        currency: amount.currency,
        price: getPerUnitAmount(priceSpec.amount, amount, priceSpec.kind),
        meta: ImmutableMap([
          ['synthetized-from', { type: 'string', value: 'price-spec' }],
        ]),
        optionMap: transaction.optionMap,
        srcCtx: transaction.srcCtx,
      },
    ];
  }

  if (cost !== null && cost.amounts.length === 1) {
    return [
      {
        type: 'price',
        date: cost.date,
        currency: amount.currency,
        price: cost.amounts[0],
        meta: ImmutableMap([
          ['synthetized-from', { type: 'string', value: 'cost-spec' }],
        ]),
        optionMap: transaction.optionMap,
        srcCtx: transaction.srcCtx,
      },
    ];
  }

  return [];
}

function getTotalAmount(
  amount: Amount,
  baseAmount: Amount,
  kind: 'per-unit' | 'total',
): Amount {
  if (kind === 'total') {
    return amount;
  } else {
    return amount.mul(baseAmount.amount);
  }
}

function getPerUnitAmount(
  amount: Amount,
  baseAmount: Amount,
  kind: 'per-unit' | 'total',
): Amount {
  if (kind === 'per-unit') {
    return amount;
  } else {
    return amount.div(baseAmount.amount);
  }
}

function getTradingAccount(
  transaction: TransactionDirective,
  posting: Posting,
  accountMapValue: AccountMapValue,
): string {
  for (const meta of [
    posting.meta,
    transaction.meta,
    accountMapValue.open?.meta,
  ]) {
    const acc = meta?.get('trading-account');
    if (acc?.type === 'account') {
      return acc.value;
    }
  }

  return 'Trading:Default';
}

function getBookingMethod(
  transaction: TransactionDirective,
  posting: Posting,
  accountMapValue: AccountMapValue,
): E.Either<Error, BookingMethod> {
  function get(): string {
    for (const meta of [
      posting.meta,
      transaction.meta,
      accountMapValue.open?.meta,
    ]) {
      const acc = meta?.get('booking-method');
      if (acc?.type === 'string') {
        return acc.value;
      }
    }
    return transaction.optionMap.get('booking-method', 'fifo');
  }

  const methodName = get();
  switch (methodName) {
    case 'fifo':
      return E.right(FIFO);
    case 'lifo':
      return E.right(LIFO);
    default:
      return E.left(new Error(`Unknown booking method: ${methodName}`));
  }
}

function formatSourceContext(srcCtx: SourceContext) {
  return `${srcCtx.filePath}:${srcCtx.row}`;
}
