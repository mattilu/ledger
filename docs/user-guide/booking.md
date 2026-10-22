# Booking and accounting rules

Ledger's booking engine applies the loaded, date-ordered directives to account
state and inventories. It validates account state, evaluates transactions,
tracks positions and prices, and checks balance assertions. Reports operate on
the booked result; use `validate` to run loading and booking without producing a
report (see [Commands](./commands.md)).

## Double-entry and balancing

Every transaction must balance independently for each currency. Ledger adds each
posting to a running multi-currency balance. A posting without an amount is
assigned the amount needed to bring that balance to zero. If the final balance
is non-zero, booking fails.

Positive amounts increase the balance in the account; negative amounts decrease
it. In this signed-amount model the accounting equation is
`Assets + Liabilities + Equity + Income + Expenses + Trading = 0`, separately
for each currency. From this formulation, it follows that liabilities, equity
and income generally have negative sign, while assets and expenses are positive
(see below for trading accounts).

For example, a positive posting to the `Assets:Bank` account when receiving your
salary would be balanced by a negative posting to the `Income:Salary` account.
Conversely, a negative posting to the `Assets:Bank` account when buying
groceries would be balanced by a positive posting to the `Expenses:Groceries`
account.

| Account       | Normal sign | Positive Amount          | Negative Amount          |
| ------------- | ----------- | ------------------------ | ------------------------ |
| `Assets`      | Positive    | You own something        | You reduced an asset     |
| `Liabilities` | Negative    | You reduced a liability  | You owe something        |
| `Equity`      | Negative    | Your net worth decreased | Your net worth increased |
| `Income`      | Negative    | You incurred a loss      | You earned something     |
| `Expenses`    | Positive    | You spent something      | You received a refund    |

The sign convention follows Beancount, which originally inspired Ledger; it may
be surprising, and Ledger does not currently provide a setting to change it.

## Accounts and dates

Directives are evaluated by date, preserving file order for directives sharing a
date. Account-reference checking is controlled by the active
`account-reference-checks` option:

- `lenient` permits accounts with no `open` declaration and rejects postings
  after `close`.
- `strict` requires accounts to be opened before use.
- `none` bypasses account-state checks.

An `open` directive may limit accepted posting currencies. A `close` directive
does not clear an account's inventory; transfer or settle the balance before
closing. Closed accounts may be reopened with a later `open`.

## Positions, costs, and trading accounts

An uncosted posting adds or subtracts the amount from the account's balance
directly. A costed augmentation creates a position with a cost basis, and
booking adds counter-postings to a trading account: the opposite commodity
amount and the total cost. By default, the generated entries use
`Trading:Default`; `trading-account` metadata can be used to select another
account. The position itself stays in the account named by the source posting;
the Trading account holds the generated balancing postings, not the position
inventory. Generated trading postings are subject to the same account checks as
ordinary postings. With `account-reference-checks` set to `strict`, declare the
trading account (including `Trading:Default` if it is used) before a costed
transaction.

This explicit use of Trading accounts for the commodity amount and cost was
chosen to keep multi-currency transactions balanced across all currencies.
Negative amounts in a trading accounts can generally be thought of as being
"long" that amount, while positive amounts can be thought as being "short".

For example, buying 10 shares for 3,000 USD can be recorded as:

```text
2026-01-01 * "Buy shares"
  Assets:Brokerage:Stocks 10 ACME {{ 3,000 USD }}
  Assets:Brokerage:Cash
```

Ledger would implicitly process this as:

```text
2026-01-01 * "Buy shares"
  Assets:Brokerage:Stocks   10 ACME { 300 USD, 2026-01-01 }
  Trading:Default          -10 ACME
  Trading:Default         3000 USD
  Assets:Brokerage:Cash
```

The cost basis is 300 USD per share, and recorded with the transaction date. The
omitted cash amount is inferred as -3,000 USD, to match the running balance of
the transaction. `{{ ... }}` specifies the total cost; `{ ... }` specifies
per-unit cost. Internally, Ledger records positions using their per-unit cost.

Cost dates and tags can also be attached to positions or used to select
positions during a reduction. See [Transaction](./directives/transaction.md) for
syntax and metadata.

When reducing a costed position, a cost selector filters eligible positions and
the booking method selects matching lots. `fifo` consumes oldest lots first;
`lifo` consumes newest lots first. The selected lots retain their cost basis as
they are reduced. Booking creates trading-account entries for the reduced
quantity and its cost. Any difference between cost and proceeds is balanced by
another posting, commonly an income account.

Continuing the previous example, if two shares with a total cost of 600 USD are
sold for 650 USD:

```text
2026-01-02 * "Sell shares"
  Assets:Brokerage:Stocks  -2 ACME {}
  Assets:Brokerage:Cash   650 USD
  Income:Capital-Gains
```

Ledger would implicitly process this as:

```text
2026-01-02 * "Sell shares"
  Assets:Brokerage:Stocks  -2 ACME { 300 USD, 2026-01-01 }
  Trading:Default           2 ACME
  Trading:Default        -600 USD
  Assets:Brokerage:Cash   650 USD
  Income:Capital-Gains
```

And the inferred capital-gains posting would be -50 USD, i.e. a 50 USD gain
(remember, income is negative).

Values in real scenarios would depend on the selected lots and their cost basis.

## Price annotations

A price annotation (`@` for per-unit, `@@` for total price) converts one
currency into another without storing the acquired position at cost. Ledger uses
the annotation to create trading-account postings and a price entry.

For example, exchanging 100 EUR for 110 USD can be recorded as:

```text
2026-01-01 * "Convert EUR -> USD"
  Assets:Brokerage:Cash 110 USD @@ 100 EUR
  Assets:Brokerage:Cash
```

Ledger would implicitly process this as:

```text
2026-01-01 * "Convert EUR -> USD"
  Assets:Brokerage:Stocks   110 USD
  Trading:Default          -110 USD
  Trading:Default           100 EUR
  Assets:Brokerage:Cash

2026-01-01 price EUR 1.1 USD
```

The omitted cash amount is inferred as 100 EUR.

Explicit [`price` directives](./directives/price.md) can also be used to
populate the price database.

## Balance assertions

A `balance` directive compares the current account balance with its asserted
amount. Assertions do not add or remove postings; a failed assertion stops
booking. An optional tolerance can be specified with `~` to allows a difference
up to the absolute tolerance.

```text
2026-01-01 balance
  Assets:Bank           1,000 USD
  Assets:Brokerage:Cash 1,000 USD ~ 0.05
```

See [Balance](./directives/balance.md).
