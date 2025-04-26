import { Either, isLeft, left, right } from 'fp-ts/lib/Either.js';
import { Map } from 'immutable';

import { Directive } from '../loading/directive.js';
import {
  Posting,
  TransactionDirective,
} from '../loading/directives/transaction.js';
import { Ledger } from '../loading/ledger.js';
import { BookingError } from './error.js';
import { Inventory, InventoryMap } from './inventory.js';
import { BookedLedger } from './ledger.js';
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
    const got = bookPosting(posting, inventories, balance);
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
  posting: Posting,
  inventories: InventoryMap,
  balance: Inventory,
): Either<Error, [BookedPosting[], InventoryMap, balance: Inventory]> {
  if (posting.costSpec !== null) {
    return left(new Error('Booking with cost spec not implemented yet'));
  }

  if (posting.amount !== null) {
    // Posting is fully specified, we can just book it.
    return right(
      doBook(inventories, balance, {
        account: posting.account,
        amount: posting.amount,
      }),
    );
  }

  // Posting doesn't specify amount, so we infer it to be the running balance of
  // the transaction, and balance it out.
  const balancePostings = balance.getPositions().map(
    (amount): BookedPosting => ({
      account: posting.account,
      amount: amount.amount.neg(),
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
        (inventory ?? Inventory.Empty).addAmount(posting.amount),
      );
      balance = balance.addAmount(posting.amount);
    }
  });
  return [postings, inventories, balance];
}
