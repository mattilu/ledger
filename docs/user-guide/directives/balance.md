# `balance`

`balance` asserts one or more account balances as of its date. For each
account/currency pair, Ledger sums the positions in that currency and compares
the result to the asserted amount. A mismatch beyond the permitted tolerance
fails booking and reports the expected value, actual value, and delta.

An optional `~` tolerance allows a delta whose absolute value is no greater than
the absolute value of the supplied number; its sign is ignored. With no
tolerance, the comparison is exact. The account is checked according to the
active `account-reference-checks` mode, but it is valid to assert a balance on
an already-closed account.

Example:

```text
2026-01-31 balance
  Assets:Bank 1,000 USD
  Assets:Brokerage:Cash 2,000 USD ~ 0.05
```

Balance assertions are useful as reconciliation checkpoints. They do not create
postings or change inventory.

See the [`balance` syntax](../syntax.md#balance) and
[account-reference-checks](../options.md#account-reference-checks).
