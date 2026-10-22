# Booking

The `booking` module applies loaded directives and produces the validated,
stateful representation consumed by reports. It handles account state, balance
checks, transaction balancing, costs, inventory updates, and generated price
directives.

## Main pieces

- `booking.ts` exposes `book(ledger, start?)`, returning
  `Either<BookingError, BookedLedger>`. The optional starting state supports
  continuing from an existing booked ledger.
- `ledger.ts` defines `BookedLedger` and its transactions, prices, account and
  currency maps, and inventories.
- `transaction.ts`, `inventory.ts`, `position.ts`, and `cost.ts` model booked
  postings and positions held at cost.
- `internal/booking-method.ts` defines the lot-reduction strategy contract;
  `internal/fifo.ts` and `internal/lifo.ts` implement FIFO and LIFO.
- `error.ts` carries the offending source directive in booking failures.

Booking consumes runtime directives from the `loading` module. Keep text parsing
and file evaluation upstream, and report-specific presentation downstream.

Costed positions remain in the account named by the source posting; the
configured Trading account receives generated balancing postings, not the
position inventory. This keeps reductions scoped to the source account and lets
booking methods focus on selecting lots and updating inventory.

## Tests and changes

`booking.test.ts` discovers `.ledger` / `.json` fixture pairs in `testdata/`;
focused tests also cover cost, inventory, position, FIFO, and LIFO behavior. For
changes to booking, test both resulting state and errors: booked postings,
balances, inventories, account rules, and prices can all be observable in
reports.

When adding a lot-reduction method, implement `BookingMethod` and test its
inventory transition. Selection precedence is implemented in
[booking.ts](./booking.ts).
