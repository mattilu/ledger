# `account-rule`

`account-rule` defines a named, reusable rule block for
[dynamic account selection](../booking.md#dynamic-account-selection) in
transaction postings.

Rule names must be non-empty and unique across the loaded Ledger (including all
files included via [`load`](./load.md)). Defining two rules with the same name
is a load error.

Example:

```text
account-rule "broker-capital-gains" {
  when direction is debit: Income:Broker:Capital-Gains:Losses,
  when direction is credit and holding-period >= 365d:
    Income:Broker:Capital-Gains:Long-Term,
  when direction is credit and holding-period < 365d:
    Income:Broker:Capital-Gains:Short-Term
}

2026-11-01 * "Close position"
  Assets:Broker   -10 ACME {}
  Assets:Cash  10,000 USD
  choose account "broker-capital-gains"
```

Named rules are validated for syntax and uniqueness during loading, and
evaluated against booking facts when referenced by a `choose account "<name>"`
posting during booking. Referencing an undefined rule name fails booking.
Unreferenced `account-rule` definitions are allowed.

See the [`account-rule` syntax](../syntax.md#account-rule),
[`transaction` reference](./transaction.md), and
[Dynamic account selection](../booking.md#dynamic-account-selection).
