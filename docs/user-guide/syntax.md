# Syntax

## Introduction

This guide describes the syntax for Ledger files, including their basic elements
and the directives used to define accounts, transactions, and prices.

This page is the shared reference for grammar and value syntax. For directive
behavior, supported metadata, and practical constraints, see the
[directive reference](./directives/index.md).

## Syntax Overview

### Currencies and Commodities

Currencies and commodities are identifiers for units of value. They must start
with a capital letter, contain at least two characters, and use only capital
letters, digits, `.`, `-`, and `_`. Currency symbols such as `$` and `€` are not
allowed.

Examples:

- `USD`
- `EUR`
- `BTC`
- `GOOG`
- `FOO.BAR`
- `BAZ-1`

In Ledger, “currency” and “commodity” are interchangeable; this guide uses
“currency” for both.

You can use a currency without declaring it. The optional `currency` and
`commodity` directives let you attach metadata, such as `format-decimals` to
control display precision.

### Amounts

An amount consists of a number followed by a currency.

Ledger uses `.` as the decimal separator, and optionally `,` as a thousands
separator.

Examples:

- `1,000 USD`
- `20.00 EUR`

Additionally, Ledger supports arithmetic expressions with the `+`, `-`, `*` and
`/` operators, as well as parentheses:

- `(10 - 5.50) EUR`
- `(1 / (2 + 3)) * 2 USD`

Ledger represents amounts as rational numbers, preserving exact precision in
calculations. Display formatting can round an amount when its currency has a
`format-decimals` value; otherwise, the formatter does not apply
currency-specific rounding.

### Accounts

Ledger tracks amounts in accounts. Account names do not have to be declared
before use, although you can enable strict account reference checking to require
accounts to be opened explicitly. An account name consists of a root account
type followed by one or more colon-separated components. Each component must
contain at least two characters, start with a capital letter or digit, and
contain only letters, digits, `-`, and `_`. The root must be `Assets`,
`Liabilities`, `Income`, `Expenses`, `Equity`, or `Trading`.

Examples:

- `Assets:Bank:HSBC:Checking`
- `Liabilities:Credit-Card:Citi`
- `Income:Salary`
- `Expenses:Groceries`
- `Equity:Opening-Balances`
- `Trading:IBKR`

Accounts implicitly define a hierarchy based on their component paths. For
example, the following accounts:

- `Assets:Bank:HSBC:Checking`
- `Assets:Bank:HSBC:Savings`
- `Assets:Brokerage:IBKR:Cash`
- `Assets:Brokerage:IBKR:Stocks`
- `Assets:Wallet`

Implicitly define the following account tree:

```text
╿
└─ Assets
   ├─ Bank
   │  └─ HSBC
   │     ├─ Checking
   │     └─ Savings
   ├─ Brokerage
   │  └─ IBKR
   │     ├─ Cash
   │     └─ Stocks
   └─ Wallet
```

### Strings

Strings are used to insert free text as part of a directive, for example in
transaction descriptions, option names or values, etc. Strings must be enclosed
in double quotes, and can contain any character except newlines and double
quotes (Ledger does not support escape characters in strings).

Example: `"Grocery Shopping"`.

### Comments

Comments are ignored by the parser. They begin with a semicolon and continue to
the end of the line.

Example: `; This is a comment`

### Dates

Dates use the `YYYY-MM-DD` format. You can optionally add a time in `hh:mm` or
`hh:mm:ss` format, followed optionally by a timezone in `[+-]hh:mm` format or
`Z` for UTC. A timezone can only be specified when a time is present. A date
without a time is interpreted as midnight UTC. When a time is present without a
timezone, Ledger uses the `default-timezone` option, or UTC if that option is
not set.

Examples:

- `2026-01-01`
- `2026-01-01 12:30`
- `2026-01-01 12:30:15`
- `2026-01-01 12:30 +02:00`
- `2026-01-01 12:30 Z`

### Metadata

Metadata allows you to attach extra information to directives or postings using
key-value pairs. It is expressed as `key: value`. Keys must start with a
lowercase letter and can only contain lowercase letters, digits, `_` and `-`.
Values can be any valid string, number (including expressions), account,
currency, date, or amount.

Examples:

- `booking-method: "lifo"`
- `seq: 1+2`
- `trading-account: Trading:IBKR`
- `base-currency: EUR`
- `expiry: 2026-01-01`
- `discount: 20 USD`

## Directives

A Ledger file consists of a sequence of _directives_. Directives define Ledger
data and configure how the loader and booking engine process it.

> IMPORTANT: Directives are categorized into two types:
>
> 1. **Dated directives:** These follow the syntax `<date> <type> …`. Ledger
>    processes them in chronological order; directives with the same date retain
>    their order in the file.
> 2. **Undated directives:** These affect parsing or loading and generally apply
>    only to subsequent directives, so their order matters.

Here are a few examples:

```text
option "account-reference-checks" "strict"

2026-01-01 open Assets:Bank

2026-01-02 * "Opening Balances"
  Assets:Bank          1,000 USD
  Equity:Opening-Balances

2026-01-03 balance Assets:Bank 1,000 USD
```

Each particular directive type is documented in a section below.

### `option`

Configures a specific behavior of the Ledger application.

Syntax:

```text
option "name" "value" [metadata]
```

Examples:

```text
option "account-reference-checks" "strict"
```

Options are specified as quoted name/value strings. For example,
`default-timezone` sets the timezone used for dates that include a time but omit
a timezone, and `account-reference-checks` controls account reference
validation.

For supported option names, defaults, scoping, and behavior, see
[Option](./directives/option.md) and [Ledger-file options](./options.md).

### `load`

Loads another Ledger file as part of the current one.

Syntax:

```text
load "path" [metadata]
```

Paths are resolved relative to the file containing the `load` directive. A path
can contain `*` wildcards, which Ledger expands automatically.

Examples:

```text
load "setup/accounts.ledger"
load "2026/*.ledger"
```

When Ledger encounters a `load` directive, it starts a new evaluation frame
using the current options as its initial state, then parses and loads the
included file. Options set in that frame do not affect the including file, but
they do affect the included file's directives and any files it loads.

See [Load behavior](./directives/load.md) for glob ordering and load errors.

### `open`

Declares an account as open as of the given date.

Syntax:

```text
<date> open <account> [currency...] [metadata]
```

You can specify one or more currencies; if you do, the account accepts postings
only in those currencies. If you omit them, no currency restriction is set by
the `open` directive.

Closed accounts can be re-opened.

Examples:

```text
2026-01-01 open Assets:Bank EUR USD
2026-01-01 open Assets:Brokerage:IBKR:Stocks
  trading-account: Trading:IBKR:Stocks
2026-01-01 open Expenses:Groceries
```

See [Open behavior and metadata](./directives/open.md).

### `close`

Closes an account, preventing further entries into it after its closing date.

Syntax:

```text
<date> close <account> [metadata]
```

Examples:

```text
2026-01-01 close Assets:Bank:Old
```

See [Close behavior](./directives/close.md).

### `currency` / `commodity`

Defines a currency or commodity and its properties.

Syntax:

```text
<date> <'currency' | 'commodity'> <name> [metadata]
```

Examples:

```text
1792-04-02 currency USD
  format-decimals: 2

2015-06-30 commodity ETH
  format-decimals: 6
```

See [Currency](./directives/currency.md) and
[Commodity](./directives/commodity.md) for display metadata behavior.

### `transaction`

Records a financial transaction. Use `txn` for the default `*` flag, or use `*`
or `!` to set the transaction's flag.

Syntax:

```text
<date> <'txn' | '*' | '!'> "description" [metadata] [postings...]
```

The `*` and `!` flags have no built-in meaning in Ledger; use them to mark
transactions or postings. For example, use `!` to mark a transaction that needs
review. The `txn` keyword implies the `*` flag.

#### Postings

Postings are the individual entries within a transaction.

Syntax:

```text
[flag] account [amount] [cost-spec] [price-spec] [metadata]
```

The **flag** is optional `*` or `!`. If not specified, the flag of the
transaction is inherited.

The **amount** is optional. If omitted, Ledger infers the amount needed to bring
the transaction's running balance to zero, separately for each currency. For
example:

```text
2026-01-01 * "Grocery Shopping"
  Expenses:Groceries  50.00 USD
  Expenses:Gifts      25.00 USD
  Assets:Bank
```

Ledger infers `-75.00 USD` for the `Assets:Bank` posting.

> **IMPORTANT: Accounting Sign Convention:** In Ledger, "income" is conceptually
> negative. When you sell a stock for a profit, the `Income:Capital-Gains`
> posting will have a negative amount to balance the positive cash inflow.

#### Cost specifications

A **cost specification** assigns a cost basis to a position or filters positions
when reducing an inventory. Single braces specify a per-unit cost; double braces
specify a total cost. The syntax is:

```text
cost-spec :: cost-spec-per-unit | cost-spec-total
cost-spec-per-unit :: '{' [cost-spec-content [',' cost-spec-content]...] '}'
cost-spec-total :: '{{' [cost-spec-content [',' cost-spec-content]...] '}}'
cost-spec-content :: amount | currency | date | string
```

> WARNING: The choice of braces is critical. Using single braces `{}` specifies
> a **per-unit** cost, while double braces `{{}}` specifies the **total** cost.

When you add a position, Ledger records it in the account's inventory with its
amount, per-unit cost, date and tags. Ledger also adds two postings to the
corresponding `Trading` account (or `Trading:Default` if none is specified): one
for the amount with its sign reversed, and one for the total cost. The total
cost remains in the transaction's running balance to be balanced by another
posting. For example:

```text
2026-01-01 * "Buy Stocks"
  Assets:Brokerage:Stocks 10 GOOG {{ 3000 USD }}
  Assets:Brokerage:Cash
```

> **TIP: Internal Ledger Representation:**
>
> The following shows how Ledger processes the transaction above. This is for
> illustrative purposes and is not the syntax you write in your Ledger files.
>
> ```text
> 2026-01-01 * "Buy Stocks"
>   Assets:Brokerage:Stocks   10 GOOG { 300 USD, 2026-01-01 }
>   Trading:Default          -10 GOOG
>   Trading:Default         3000 USD
>   Assets:Brokerage:Cash
> ```

Ledger then infers `-3000 USD` for the `Assets:Brokerage:Cash` posting.

When reducing a position, Ledger uses the cost specification to filter the
positions eligible for reduction, then applies the configured booking method
(`fifo` or `lifo`). The reduction is posted against the corresponding trading
account. Continuing the example:

```text
2026-01-02 * "Sell Stocks"
  Assets:Brokerage:Stocks   -2 GOOG {}
  Assets:Brokerage:Cash    610 USD
  Income:Stocks:Capital-Gains
```

> **TIP: Internal Ledger Representation:**
>
> ```text
> 2026-01-02 * "Sell Stocks"
>   Assets:Brokerage:Stocks       -2 GOOG { 300 USD, 2026-01-01 }
>   Trading:Default                2 GOOG
>   Trading:Default             -600 USD
>   Assets:Brokerage:Cash        610 USD
>   Income:Stocks:Capital-Gains
> ```

Ledger infers `-10 USD` for the `Income:Stocks:Capital-Gains` posting. Income is
represented as a negative amount.

See [Transaction behavior and metadata](./directives/transaction.md) and
[Booking and accounting rules](./booking.md).

#### Price specifications

A **price specification** tells the booking system to use a specific unit price
or total price for a posting. Unlike a cost specification, it does not save the
posting at cost. It is specified as `@ amount` for a per-unit price, or
`@@ amount` for a total price.

Similar to the cost specification, Ledger uses trading-account postings to
balance the conversion. For example:

```text
2026-01-03 * "Exchange USD -> EUR"
  Assets:Bank 100 EUR @ 1.17 USD
  Assets:Bank
```

> **TIP: Internal Ledger Representation:**
>
> ```text
> 2026-01-03 * "Exchange USD -> EUR"
>   Assets:Bank      100 EUR
>   Trading:Default -100 EUR
>   Trading:Default  117 USD
>   Assets:Bank
> ```

And Ledger infers `-117 USD` for the final `Assets:Bank` posting.

### `price`

Adds an entry to the price database for a currency at a given time.

Syntax:

```text
<date> price <currency> <amount> [metadata]
```

Example:

```text
2026-01-01 price EUR 1.17 USD
```

See [Price behavior](./directives/price.md) and
[Unrealized P&L](./reports/unrealized-pnl.md).

### `balance`

Asserts the balance of accounts on a specific date. If the balance does not
match (optionally within an approximate amount), Ledger reports an error.

Syntax:

```text
<date> balance [metadata] [account amount [~ number]]...
```

Examples:

```text
2026-01-31 balance
  Assets:Bank           1,000 USD
  Assets:Brokerage:Cash 2,000 USD ~ 0.05
```

See [Balance behavior](./directives/balance.md).
