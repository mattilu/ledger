import { strict as assert } from 'node:assert';

import { ExactNumber } from 'exactnumber';
import { either as E, function as F } from 'fp-ts';
import { Map } from 'immutable';

import { Amount } from '../core/amount.js';
import { Directive, DirectiveCommon } from '../loading/directive.js';
import { CloseDirective } from '../loading/directives/close.js';
import { OpenDirective } from '../loading/directives/open.js';
import {
  CostSpec,
  Posting,
  TransactionDirective,
} from '../loading/directives/transaction.js';
import { Ledger } from '../loading/ledger.js';
import { Metadata } from '../loading/metadata.js';
import { SourceContext } from '../loading/source-context.js';
import { DateSpec } from '../parsing/spec/date.js';
import { Formatter } from '../utils/formatting.js';
import { Cost } from './cost.js';
import { BookingError } from './error.js';
import { BookingMethod } from './internal/booking-method.js';
import { FIFO } from './internal/fifo.js';
import { LIFO } from './internal/lifo.js';
import { Inventory, InventoryMap } from './inventory.js';
import { AccountMap, BookedLedger } from './ledger.js';
import { Position } from './position.js';
import { BookedPosting, Transaction } from './transaction.js';

const ZERO = ExactNumber(0);

/**
 * Runs booking logic, transforming a Ledger to a BookedLedger.
 *
 * @param ledger Ledger containing directives to evaluate.
 * @param start Optional, starting state to book from. Can be used to execute
 *   additional directives on top of a previous `book` result.
 * @returns A BookedLedger, or a BookingError in case of failure.
 */
export function book(
  ledger: Ledger,
  start?: BookedLedger,
): E.Either<BookingError, BookedLedger> {
  const transactions: Transaction[] = [];
  let accountMap: AccountMap = start?.accountMap ?? Map();
  const currencyMap = start?.currencyMap ?? ledger.currencyMap;
  let inventories: InventoryMap = start?.inventories ?? Map();

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
            let msg = `Balance for ${balance.account} does not match.
Expected: ${formatter.formatAmount(balance.amount)}
Actual: ${formatter.formatAmount(amount)}
Delta: ${formatter.formatAmount(delta)}`;
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
        if (accountCheck.right?.type === 'close') {
          return E.left(
            new BookingError(
              `Account ${directive.account} is already closed (at ` +
                `${formatSourceContext(accountCheck.right.srcCtx)})`,
              directive,
            ),
          );
        }
        accountMap = accountMap.set(directive.account, directive);
        break;
      }
      case 'open': {
        // Note: reopening a closed account is allowed.
        const account = accountMap.get(directive.account, null);
        if (account?.type === 'open') {
          return E.left(
            new BookingError(
              `Account ${directive.account} is already open (at ` +
                `${formatSourceContext(account.srcCtx)})`,
              directive,
            ),
          );
        }
        accountMap = accountMap.set(directive.account, directive);
        break;
      }
      case 'transaction': {
        const got = bookTransaction(directive, inventories, accountMap);
        if (E.isLeft(got)) {
          return E.left(enrichError(got.left, directive));
        }

        transactions.push(got.right);
        inventories = got.right.inventoriesAfter;
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
    accountMap,
    currencyMap,
    inventories,
  });
}

function checkValidAccount(
  accountMap: AccountMap,
  optionMap: Map<string, string>,
  account: string,
  options?: { allowClosed: boolean },
): E.Either<Error, OpenDirective | CloseDirective | null> {
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
    return E.right(state);
  }

  if (state?.type === 'close' && !(options?.allowClosed ?? false)) {
    return E.left(
      new Error(
        `Account ${account} has been closed ` +
          `(at ${formatSourceContext(state.srcCtx)})`,
      ),
    );
  }

  if (state === null && referenceChecksMode === 'strict') {
    return E.left(new Error(`Account ${account} has not been opened`));
  }

  return E.right(state);
}

function enrichError(error: Error, directive: Directive) {
  return new BookingError(error.message, directive, { cause: error });
}

function bookTransaction(
  transaction: TransactionDirective,
  inventories: InventoryMap,
  accountMap: AccountMap,
): E.Either<Error, Transaction> {
  const inventoriesBefore = inventories;
  const postings: BookedPosting[] = [];
  let balance = Inventory.Empty;

  for (const posting of transaction.postings) {
    const accountCheck = checkValidAccount(
      accountMap,
      transaction.optionMap,
      posting.account,
    );
    if (E.isLeft(accountCheck)) {
      return accountCheck;
    }

    const got = bookPosting(
      transaction,
      posting,
      inventories,
      balance,
      accountCheck.right,
    );
    if (E.isLeft(got)) {
      return got;
    }

    let bookedPostings: BookedPosting[];
    [bookedPostings, inventories, balance] = got.right;

    const allowedCurrencies =
      accountCheck?.right?.type === 'open' ? accountCheck.right.currencies : [];
    if (allowedCurrencies.length > 0) {
      for (const posting of bookedPostings) {
        if (allowedCurrencies.indexOf(posting.amount.currency) === -1) {
          return E.left(
            new Error(
              `Currency ${posting.amount.currency} not allowed in account ${posting.account}`,
            ),
          );
        }
      }
    }

    postings.push(...bookedPostings);
  }

  if (!balance.isEmpty()) {
    return E.left(
      new Error(`Transaction does not balance. Residual:\n${balance}`),
    );
  }

  return E.right({
    date: transaction.date,
    description: transaction.description,
    flag: transaction.flag,
    postings,
    meta: transaction.meta,
    inventoriesBefore,
    inventoriesAfter: inventories,
    srcCtx: transaction.srcCtx,
  });
}

function bookPosting(
  transaction: TransactionDirective,
  posting: Posting,
  inventories: InventoryMap,
  balance: Inventory,
  accountDirective: OpenDirective | CloseDirective | null,
): E.Either<Error, [BookedPosting[], InventoryMap, balance: Inventory]> {
  if (posting.costSpec !== null) {
    const tradingAccount = getTradingAccount(
      transaction,
      posting,
      accountDirective?.type === 'open' ? accountDirective : null,
    );
    if (posting.amount !== null && posting.costSpec.amounts.length > 0) {
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
        E.map(() =>
          doBook(
            inventories,
            balance,
            {
              account: posting.account,
              flag: posting.flag,
              amount: postingAmount,
              cost: new Cost(
                costSpec.amounts.map(amount =>
                  getPerUnitAmount(amount, postingAmount, costSpec),
                ),
                costSpec.dates.length === 1
                  ? costSpec.dates[0]
                  : transaction.date,
                costSpec.dateSpecs.length === 1
                  ? costSpec.dateSpecs[0]
                  : transaction.dateSpec,
                costSpec.tags,
              ),
              meta: posting.meta,
            },
            {
              account: tradingAccount,
              flag: posting.flag,
              amount: postingAmount.neg(),
              cost: null,
              meta: Map(),
            },
            ...costSpec.amounts.map(amount => ({
              account: tradingAccount,
              flag: posting.flag,
              amount: getTotalAmount(amount, postingAmount, costSpec),
              cost: null,
              meta: Map() as Metadata,
            })),
          ),
        ),
      );
    }

    if (posting.amount !== null) {
      assert(posting.costSpec.amounts.length === 0);

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
        getBookingMethod(
          transaction,
          posting,
          accountDirective?.type === 'open' ? accountDirective : null,
        ),
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

      const postings: BookedPosting[] = [];
      for (const posting of bookResult.right[0]) {
        let postings1: BookedPosting[] = [];
        [postings1, inventories, balance] = doBook(
          inventories,
          balance,
          // Post the reduction as we got it from the booking method, e.g.
          //
          // Assets:Broker    -60 USD { 1.2 CHF }
          //
          posting,
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
            meta: Map(),
          },
          ...(posting.cost?.amounts ?? []).map(cost => ({
            account: tradingAccount,
            flag: posting.flag,
            amount: cost.mul(posting.amount.amount),
            cost: null,
            meta: Map() as Metadata,
          })),
        );
        postings.push(...postings1);
      }

      // Overwrite the inventory for the account with the result from the
      // booking method, as it could apply different changes, like averaging
      // cost of positions.
      inventories = inventories.set(
        posting.account,
        mergeInventories(inventoryRest, bookResult.right[1]),
      );

      return E.right([postings, inventories, balance]);
    }

    return E.left(
      new Error('Booking with cost spec inference not implemented yet'),
    );
  }

  if (posting.amount !== null) {
    // Posting is fully specified, we can just book it.
    return E.right(
      doBook(inventories, balance, {
        account: posting.account,
        flag: posting.flag,
        amount: posting.amount,
        cost: null,
        meta: posting.meta,
      }),
    );
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
    }),
  );
  return E.right(doBook(inventories, balance, ...balancePostings));
}

function validateCostSpecForAugmentation(
  costSpec: CostSpec,
): E.Either<Error, {}> {
  if (costSpec.dates.length > 1 || costSpec.dateSpecs.length > 1) {
    return E.left(new Error('Augmentation cannot specify more than one date'));
  }
  if (costSpec.currencies.length > 0) {
    return E.left(new Error('Augmentation cannot specify currencies'));
  }
  return E.of({});
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

  function dateSpecMatches(dateSpec: DateSpec, match: DateSpec) {
    if (dateSpec.date !== match.date) {
      return false;
    }
    if (match.time === null) {
      return true;
    }
    if (dateSpec.time !== match.time) {
      return false;
    }
    if (match.timezone === null) {
      return true;
    }
    return dateSpec.timezone === match.timezone;
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

function doBook(
  inventories: InventoryMap,
  balance: Inventory,
  ...postings: BookedPosting[]
): [BookedPosting[], InventoryMap, balance: Inventory] {
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
  return [postings, inventories, balance];
}

function getTotalAmount(
  amount: Amount,
  baseAmount: Amount,
  costSpec: CostSpec,
): Amount {
  if (costSpec.kind === 'total') {
    return amount;
  } else {
    return amount.mul(baseAmount.amount);
  }
}

function getPerUnitAmount(
  amount: Amount,
  baseAmount: Amount,
  costSpec: CostSpec,
): Amount {
  if (costSpec.kind === 'per-unit') {
    return amount;
  } else {
    return amount.div(baseAmount.amount);
  }
}

function getTradingAccount(
  transaction: TransactionDirective,
  posting: Posting,
  openDirective: OpenDirective | null,
): string {
  for (const meta of [posting.meta, transaction.meta, openDirective?.meta]) {
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
  openDirective: OpenDirective | null,
): E.Either<Error, BookingMethod> {
  function get(): string {
    for (const meta of [posting.meta, transaction.meta, openDirective?.meta]) {
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
