import { strict as assert } from 'node:assert';

import { Either, isLeft, left, right } from 'fp-ts/lib/Either.js';
import { Map } from 'immutable';

import { Amount } from '../core/amount.js';
import { Directive, DirectiveCommon } from '../loading/directive.js';
import { CloseDirective } from '../loading/directives/close.js';
import { OpenDirective } from '../loading/directives/open.js';
import {
  Posting,
  TransactionDirective,
} from '../loading/directives/transaction.js';
import { Ledger } from '../loading/ledger.js';
import { SourceContext } from '../loading/source-context.js';
import { CostSpec } from '../parsing/spec/directives/transaction.js';
import { Cost } from './cost.js';
import { BookingError } from './error.js';
import { FIFO } from './internal/fifo.js';
import { Inventory, InventoryMap } from './inventory.js';
import { BookedLedger } from './ledger.js';
import { Position } from './position.js';
import { BookedPosting, Transaction } from './transaction.js';

type AccountMap = Map<string, OpenDirective | CloseDirective>;

export function book(ledger: Ledger): Either<BookingError, BookedLedger> {
  const transactions: Transaction[] = [];
  let accountMap: AccountMap = Map();
  let inventories: InventoryMap = Map();

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
          if (isLeft(accountCheck)) {
            return left(enrichError(accountCheck.left, directive));
          }

          const inventory = inventories.get(balance.account, Inventory.Empty);
          const amount = inventory
            .getPositionsForCurrency(balance.amount.currency)
            .reduce(
              (acc, v) => acc.add(v.amount),
              Amount.zero(balance.amount.currency),
            );
          if (!amount.eq(balance.amount)) {
            return left(
              new BookingError(
                `Balance does not match.
Expected: ${balance.amount}
Actual: ${amount}
Delta: ${balance.amount.sub(amount)}`,
                directive,
              ),
            );
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
        if (isLeft(accountCheck)) {
          return left(enrichError(accountCheck.left, directive));
        }
        if (accountCheck.right?.type === 'close') {
          return left(
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
          return left(
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
        if (isLeft(got)) {
          return left(enrichError(got.left, directive));
        }

        transactions.push(got.right);
        inventories = got.right.inventoriesAfter;
        break;
      }
      default: {
        const d = directive as DirectiveCommon<string>;
        return left(
          new BookingError(
            `${d.type} directive not implemented yet`,
            directive,
          ),
        );
      }
    }
  }

  return right({
    transactions,
  });
}

function checkValidAccount(
  accountMap: AccountMap,
  optionMap: Map<string, string>,
  account: string,
  options?: { allowClosed: boolean },
): Either<Error, OpenDirective | CloseDirective | null> {
  const state = accountMap.get(account, null);
  const referenceChecksMode = optionMap.get(
    'account-reference-checks',
    'lenient',
  );

  const validModes = ['none', 'lenient', 'strict'];
  if (validModes.indexOf(referenceChecksMode) === -1) {
    return left(
      new Error(
        `Invalid account-reference-checks mode: ${referenceChecksMode}, ` +
          `expected one of ${validModes.join(', ')}`,
      ),
    );
  }

  if (referenceChecksMode === 'none') {
    return right(state);
  }

  if (state?.type === 'close' && !(options?.allowClosed ?? false)) {
    return left(
      new Error(
        `Account ${account} has been closed ` +
          `(at ${formatSourceContext(state.srcCtx)})`,
      ),
    );
  }

  if (state === null && referenceChecksMode === 'strict') {
    return left(new Error(`Account ${account} has not been opened`));
  }

  return right(state);
}

function enrichError(error: Error, directive: Directive) {
  return new BookingError(error.message, directive, { cause: error });
}

function bookTransaction(
  transaction: TransactionDirective,
  inventories: InventoryMap,
  accountMap: AccountMap,
): Either<Error, Transaction> {
  const inventoriesBefore = inventories;
  const postings: BookedPosting[] = [];
  let balance = Inventory.Empty;

  for (const posting of transaction.postings) {
    const accountCheck = checkValidAccount(
      accountMap,
      transaction.optionMap,
      posting.account,
    );
    if (isLeft(accountCheck)) {
      return accountCheck;
    }

    const got = bookPosting(transaction, posting, inventories, balance);
    if (isLeft(got)) {
      return got;
    }

    let bookedPostings: BookedPosting[];
    [bookedPostings, inventories, balance] = got.right;

    const allowedCurrencies =
      accountCheck?.right?.type === 'open' ? accountCheck.right.currencies : [];
    if (allowedCurrencies.length > 0) {
      for (const posting of bookedPostings) {
        if (allowedCurrencies.indexOf(posting.amount.currency) === -1) {
          return left(
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
    return left(
      new Error(`Transaction does not balance. Residual:\n${balance}`),
    );
  }

  return right({
    date: transaction.date,
    description: transaction.description,
    postings,
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
): Either<Error, [BookedPosting[], InventoryMap, balance: Inventory]> {
  if (posting.costSpec !== null) {
    const tradingAccount = 'Trading:Default';
    if (posting.amount !== null && posting.costSpec.amounts.length > 0) {
      // Both cost and amount are known. We increase the account by the amount,
      // and post the opposite at-cost, and the cost, to the trading account.
      // This leaves the amount of the cost in the running balance, which is
      // usually balanced with a posting without amount.
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
      //   Assets:Broker    2 VT
      //   Trading:Default -2 VT { 150 CHF }
      //   Trading:Default  300 CHF
      //   Assets:Broker ; -300 CHF, inferred
      const postingAmount = posting.amount;
      const costSpec = posting.costSpec;
      return right(
        doBook(
          inventories,
          balance,
          {
            account: posting.account,
            amount: posting.amount,
            cost: null,
          },
          {
            account: tradingAccount,
            amount: posting.amount.neg(),
            cost: new Cost(
              posting.costSpec.amounts.map(amount =>
                getPerUnitAmount(amount, postingAmount, costSpec),
              ),
              transaction.date,
            ),
          },
          ...posting.costSpec.amounts.map(amount => ({
            account: tradingAccount,
            amount: getTotalAmount(amount, postingAmount, costSpec),
            cost: null,
          })),
        ),
      );
    }

    if (posting.amount !== null) {
      assert(posting.costSpec.amounts.length === 0);

      // Amount is known, but cost is not. We treat this as a reduction, and
      // invoke the booking method (currently only FIFO is supported.)
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
      //   Assets:Broker     -2 VT
      //   Trading:Default    2 VT { 150 CHF }
      //   Trading:Default -300 CHF
      //   Assets:Broker    350 CHF
      //   Income:Trading ; -50 CHF, inferred
      let postings: BookedPosting[];
      [postings, inventories, balance] = doBook(inventories, balance, {
        account: posting.account,
        amount: posting.amount,
        cost: null,
      });

      const bookResult = FIFO.book(
        tradingAccount,
        posting.amount.neg(),
        inventories.get(tradingAccount) ?? Inventory.Empty,
      );
      if (isLeft(bookResult)) {
        return bookResult;
      }

      let postings1: BookedPosting[];
      [postings1, , balance] = doBook(
        inventories,
        balance,
        ...bookResult.right[0],
      );

      postings.push(...postings1);
      inventories = inventories.set(tradingAccount, bookResult.right[1]);

      return right([postings, inventories, balance]);
    }

    return left(
      new Error('Booking with cost spec inference not implemented yet'),
    );
  }

  if (posting.amount !== null) {
    // Posting is fully specified, we can just book it.
    return right(
      doBook(inventories, balance, {
        account: posting.account,
        amount: posting.amount,
        cost: null,
      }),
    );
  }

  // Posting doesn't specify amount, so we infer it to be the running balance of
  // the transaction, and balance it out.
  const balancePostings = balance.getPositions().map(
    (amount): BookedPosting => ({
      account: posting.account,
      amount: amount.amount.neg(),
      cost: null,
    }),
  );
  return right(doBook(inventories, balance, ...balancePostings));
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

function formatSourceContext(srcCtx: SourceContext) {
  return `${srcCtx.filePath}:${srcCtx.row}`;
}
