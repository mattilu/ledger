import { Either, isLeft, left, right } from 'fp-ts/lib/Either.js';
import { Map } from 'immutable';

import { Amount } from '../core/amount.js';
import { Directive } from '../loading/directive.js';
import {
  Posting,
  TransactionDirective,
} from '../loading/directives/transaction.js';
import { Ledger } from '../loading/ledger.js';
import { CostSpec } from '../parsing/spec/directives/transaction.js';
import { Cost } from './cost.js';
import { BookingError } from './error.js';
import { Inventory, InventoryMap } from './inventory.js';
import { BookedLedger } from './ledger.js';
import { Position } from './position.js';
import { BookedPosting, Transaction } from './transaction.js';

export function book(ledger: Ledger): Either<BookingError, BookedLedger> {
  const transactions: Transaction[] = [];
  let inventories: InventoryMap = Map();

  for (const directive of ledger.directives) {
    switch (directive.type) {
      case 'transaction': {
        const got = bookTransaction(directive, inventories);
        if (isLeft(got)) {
          return left(enrichError(got.left, directive));
        }

        transactions.push(got.right);
        inventories = got.right.inventoriesAfter;
        break;
      }
    }
  }

  return right({
    transactions,
  });
}

function enrichError(error: Error, directive: Directive) {
  return new BookingError(error.message, directive, { cause: error });
}

function bookTransaction(
  transaction: TransactionDirective,
  inventories: InventoryMap,
): Either<Error, Transaction> {
  const inventoriesBefore = inventories;
  const postings: BookedPosting[] = [];
  let balance = Inventory.Empty;

  for (const posting of transaction.postings) {
    const got = bookPosting(transaction, posting, inventories, balance);
    if (isLeft(got)) {
      return got;
    }

    let bookedPostings: BookedPosting[];
    [bookedPostings, inventories, balance] = got.right;
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
