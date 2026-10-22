# Cookbook

This page collects common Ledger patterns. For shared grammar and supported
value syntax, see [Syntax](./syntax.md); for command-line options, see
[Commands](./commands.md).

The examples are independent snippets unless noted otherwise. They assume the
default `lenient` account-reference mode; if strict checks are enabled, declare
every account used, including any generated trading account.

## Start with declared accounts and strict checks

Strict checking catches misspelled or undeclared account names during
validation:

```text
option "account-reference-checks" "strict"

2026-01-01 open Assets:Bank:Checking USD
2026-01-01 open Expenses:Groceries USD
2026-01-01 open Equity:Opening-Balances USD
```

Declare each account before the first transaction that uses it. For the
supported check modes, see [Options](./options.md#account-reference-checks).

## Record an opening balance

Use an equity account as the balancing account for an initial balance:

```text
2026-01-01 * "Opening balance"
  Assets:Bank:Checking 1,000 USD
  Equity:Opening-Balances
```

The omitted equity amount is inferred as -1,000 USD.

## Record an expense paid from a bank account

```text
2026-01-01 * "Groceries"
  Expenses:Groceries 54.20 USD
  Assets:Bank:Checking
```

The bank posting is inferred as -54.20 USD. An expense posting is positive under
Ledger's sign convention.

## Track an investment purchase and sale

Record shares at cost, with total cost in double braces:

```text
2026-01-01 * "Buy 10 shares"
  Assets:Brokerage:Stocks 10 ACME {{ 3,000 USD }}
  Assets:Brokerage:Cash
```

Ledger stores a per-share cost basis of 300 USD and infers the cash reduction.
To sell two shares for 650 USD:

```text
2026-01-02 * "Sell 2 shares"
  Assets:Brokerage:Stocks  -2 ACME {}
  Assets:Brokerage:Cash   650 USD
  Income:Capital-Gains
```

With a 600 USD cost basis for the shares sold, the inferred income posting is
-50 USD. A negative income posting is a gain under Ledger's sign convention.

Which lot is reduced depends on the selected booking method; see
[Booking](./booking.md#positions-costs-and-trading-accounts).

## Short selling

Record the negative shares at cost, with a negative total cost in double braces:

```text
2026-01-01 * "Short sell 10 shares"
  Assets:Brokerage:Stocks -10 ACME {{ -3,000 USD }}
  Assets:Brokerage:Cash
```

Ledger stores a negative position with a per-share cost basis of 300 USD and
infers the cash augmentation. To rebuy two shares for 650 USD:

```text
2026-01-02 * "Rebuy 2 shares"
  Assets:Brokerage:Stocks   2 ACME {}
  Assets:Brokerage:Cash  -650 USD
  Income:Capital-Gains
```

With a -600 USD cost basis for the bought shares, the inferred income posting is
50 USD. A positive income posting is a loss under Ledger's sign convention.

## Add prices and estimate unrealized P&L

Record exchange prices for the date of the quote:

```text
2026-02-01 price ACME 70 USD
```

Then run the report:

```bash
npm run -s main -- report unrealized-pnl main.ledger
```

The report compares the quote with each position's cost. Without a usable price
it uses the cost as the current value. See
[Unrealized P&L](./reports/unrealized-pnl.md).

## Reconcile an account

Add a dated assertion after the transactions expected to affect the balance:

```text
2026-01-31 balance
  Assets:Bank:Checking 945.80 USD ~ 0.01
```

This accepts a difference of at most 0.01 USD. A mismatch stops validation or
report generation. See [Balance](./directives/balance.md).

## Review transactions marked for attention

Use the `!` flag on a transaction or posting, then filter for that flag:

```text
2026-02-02 ! "Check missing receipt"
  Expenses:Travel 25 USD
  Assets:Bank:Checking
```

```bash
npm run -s main -- report transactions main.ledger --flag '!' --all-postings
```

Flags are labels; they do not change how an entry is booked. See
[Transactions report](./reports/transactions.md).

## Split a Ledger file into multiple files

Keep account setup and dated activity separate:

```text
; main.ledger
option "account-reference-checks" "strict"
load "setup/accounts.ledger"
load "2026/*.ledger"
```

The glob is expanded in lexicographic order, so use names that sort in the
intended sequence (for example, `2026/01.ledger`, `2026/02.ledger`). An option
set inside a loaded file does not flow back to its parent. See
[Load](./directives/load.md).

## Use a custom trading account or booking method

Set defaults on the account and override them for a specific transaction or
posting when needed:

```text
2026-01-01 open Assets:Brokerage:Stocks
  trading-account: Trading:Brokerage
  booking-method: "fifo"
```

For `trading-account` and `booking-method` precedence, see
[Transaction metadata](./directives/transaction.md#behavior-changing-metadata).
