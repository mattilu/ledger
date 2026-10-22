# Utilities

The `utils` module contains reusable algorithms and presentation helpers shared
by domain modules. It is not a catch-all for business workflows: keep accounting
rules in booking, report calculations in reporting, and file/ledger evaluation
in loading.

## Main pieces

- `formatting.ts` provides `Formatter` and output options for amounts,
  positions, inventories, accounts, and transactions.
- `price-db.ts` provides a date-aware `PriceDatabase`, including direct and
  indirect price lookup and interpolation options.
- `bounds.ts` provides partition/bound searches over sorted arrays.
- `heap.ts` provides heap operations used by booking methods and graph search.
- `internal/account-tree.ts` formats hierarchical account results.
- `internal/graph.ts` provides weighted path search used by indirect price
  conversion.

## Tests and changes

Each public utility has a colocated test file. Add focused tests for boundary
conditions and invariant requirements; for example, bound-search helpers require
correctly partitioned input, and price lookup depends on date and currency-pair
behavior. The price database and graph implementations are related but have
distinct tests.
