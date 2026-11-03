# Core

The `core` module contains domain value types shared by all the other modules.
As such, it should not depend on any other Ledger module.

## Current contents

- `account.ts` defines `AccountType` and `NormalBalanceSide` enums, as well as
  functions to work with them.
- `amount.ts` defines `Amount`, pairing an exact numeric value with its
  currency. Arithmetic and comparisons that combine amounts check that the
  currencies match. Numeric values use `exactnumber`, avoiding binary floating
  point arithmetic for Ledger amounts.
- `sign-convention.ts` defines `SignConvention` enum and functions to work with
  it: parsing, conversion between user-facing and canonical amounts, etc.

## Tests and changes

Tests are colocated (`amount.test.ts`). When changing amount semantics, test
currency mismatch behavior, exact arithmetic, normalization, and serialization
as applicable; downstream booking and formatting tests also depend on this value
type.
