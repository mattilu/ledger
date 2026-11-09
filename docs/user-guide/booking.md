# Booking and accounting rules

Ledger's booking engine applies the loaded, date-ordered directives to account
state and inventories. It validates account state, evaluates transactions,
tracks positions and prices, and checks balance assertions. Reports operate on
the booked result; use `validate` to run loading and booking without producing a
report (see [Commands](./commands.md)).

## Double-entry and balancing

In double-entry accounting, each journal entry line is either a "debit" (posted
to the left side of a ledger account) or a "credit" (posted to the right side).
An account's _normal balance side_ is the side that increases the account value
when a (positive) line item is posted to it.

Example:

| Date       | Description      | Account            | Debit    | Credit   | Balance  |
| ---------- | ---------------- | ------------------ | -------- | -------- | -------- |
| 2026-01-01 | Receive salary   | Income:Salary      |          | 2000 USD | 2000 USD |
|            |                  | Assets:Bank        | 2000 USD |          | 2000 USD |
|            |                  |                    |          |          |          |
| 2026-01-02 | Grocery shopping | Expenses:Groceries | 200 USD  |          | 200 USD  |
|            |                  | Assets:Bank        |          | 200 USD  | 1800 USD |

In Ledger, journal entry lines (or postings, in ledger's terms) don't explicitly
use two columns. Instead, the default convention is for positive amounts to be
interpreted as debits and negative amounts as credits.

The example transactions above would be written in Ledger syntax as:

```text
2026-01-01 * "Receive salary"
  Income:Salary     -1,000 USD
  Assets:Bank        1,000 USD

2026-01-02 * "Grocery shopping"
  Expenses:Groceries   200 USD
  Assets:Bank         -200 USD
```

Every transaction must balance independently for each currency. Ledger adds each
posting to a running multi-currency balance. A posting without an amount is
assigned the amount needed to bring that balance to zero. If the final balance
is non-zero, booking fails.

In this signed-amount model the accounting equation is:

$$ Assets + Liabilities + Equity + Income + Expenses + Trading = 0 $$

separately for each currency. From this formulation, it follows that
liabilities, equity and income generally have negative sign, while assets and
expenses are positive (see below for trading accounts).

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

This sign convention follow Beancount, which originally inspired Ledger.

### Alternative sign conventions

Ledger also supports alternative sign conventions, which you can select with the
`sign-convention` option.

With the `normal-balance-positive` option, positive amounts represent debits on
debit-normal accounts (`Assets`, `Expenses`) and credits on credit-normal
accounts (`Liabilities`, `Equity`, `Income`), i.e. all amounts would generally
be positive.

With this convention, the same example would be written as:

```text
option "sign-convention" "normal-balance-positive"

2026-01-01 * "Receive salary"
  Income:Salary      1,000 USD
  Assets:Bank        1,000 USD

2026-01-02 * "Grocery shopping"
  Expenses:Groceries   200 USD
  Assets:Bank         -200 USD
```

With the `net-worth-positive` option, positive amounts represent values that
increase the net worth, while negative amounts would decrease it (postings to
`Expenses` and `Liabilities` accounts would generally be negative).

With this convention, the same example would be written as:

```text
option "sign-convention" "net-worth-positive"

2026-01-01 * "Receive salary"
  Income:Salary      1,000 USD
  Assets:Bank        1,000 USD

2026-01-02 * "Grocery shopping"
  Expenses:Groceries  -200 USD
  Assets:Bank         -200 USD
```

See [Ledger-file options](./options.md#sign-convention) for the full sign
mapping.

An `open` directive can set `normal-balance: "debit"` or
`normal-balance: "credit"` to override the normal-balance side implied by its
account family. This supports contra accounts such as `Expenses:Rebates` or
`Income:Capital-Losses` accounts. The closest ancestor's setting is inherited
when an account has no explicit setting.

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

## Dynamic account selection

When the direction or tax treatment of an inferred amount depends on which lots
are reduced during booking, an omitted-amount posting can use `choose account`
(inline or via a named [`account-rule`](./directives/account-rule.md)) to select
the destination account from booking-time facts:

```text
2026-11-02 * "Sell shares"
  Assets:Brokerage:Stocks  -10 ACME {}
  Assets:Brokerage:Cash    950 USD
  choose account {
    when direction is debit: Income:Capital-Gains:Losses,
    when direction is credit and holding-period < 365d:
      Income:Capital-Gains:Short-Term,
    when direction is credit and holding-period >= 365d:
      Income:Capital-Gains:Long-Term
  }
```

### Reduction groups and aggregate residuals

A `choose account` posting evaluates two kinds of candidate amounts:

1. **Per-lot reduction portions (`context is reduction`):** A posting that
   reduces one or more costed lots opens a _reduction group_. Subsequent
   unannotated postings with explicit amounts in the reduced lots' cost
   currencies contribute proceeds to that group until another reduction, a cost-
   or price-annotated posting, an ordinary omitted-amount posting, or a
   `choose account` posting closes the group.
   - Multiple explicit amounts in the same group (such as gross sale proceeds
     and fees) are netted by currency, then allocated proportionally across the
     reduced units.
   - Each reduced lot produces its own realized portion equal to the inverse of
     (`allocated proceeds + cost basis`), so a single reduction spanning
     multiple lots can route gains and losses or different holding periods to
     separate accounts.
   - A reduction group with no explicit proceeds has zero proceeds (for example,
     when an option expires worthless).
2. **Per-currency balance residuals (`context is aggregate`):** All other
   running-balance effects—including amounts before any reduction, costed
   augmentations, price-annotated conversions, and amounts in currencies outside
   the reduced lots' cost basis—are combined into one aggregate residual per
   currency, equal to the inverse of the current running balance minus any
   pending reduction portions in that currency.

### Available booking facts

Each nonzero portion is evaluated against the rule clauses using its facts:

| Attribute        | Context                  | Values / Type            | Description                                                                                                                                        |
| ---------------- | ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `context`        | `reduction`, `aggregate` | `reduction`, `aggregate` | Whether the portion is a per-lot realized amount or a general per-currency balance residual.                                                       |
| `direction`      | `reduction`, `aggregate` | `debit`, `credit`        | Accounting direction of the inferred portion (`debit` for canonical positive, `credit` for negative), independent of the active `sign-convention`. |
| `source-account` | `reduction` only         | Account                  | The account from which the lot was reduced.                                                                                                        |
| `holding-period` | `reduction` only         | Duration (`<number>d`)   | Elapsed days between the lot's acquisition date and the transaction date.                                                                          |

Referencing `source-account` or `holding-period` when evaluating an `aggregate`
residual is a booking error unless guarded earlier in the condition (for
example, `when context is reduction and holding-period >= 365d: ...`).

### Evaluation, chaining, and validation

Clauses are evaluated in source order; the first matching `when` clause (or the
optional final `otherwise` clause) selects the account for that portion. Zero
portions are ignored and do not emit postings.

Only accounts selected for a nonzero portion are checked against
`account-reference-checks` and currency restrictions; unselected candidate
accounts are not validated.

If a portion matches no clause in a `choose account` posting, it remains
pending: unmatched reduction portions carry forward with their lot context to
subsequent `choose account` postings, and unmatched residuals remain in the
running balance. An ordinary omitted-amount posting consumes the entire
remaining balance and clears any pending reduction portions.

See [Syntax](./syntax.md#dynamic-account-selection) for the condition grammar.

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
booking. Its amount is interpreted using the active `sign-convention` and
account normal-balance side. A failure displays expected, actual, and delta
values in that convention. An optional tolerance can be specified with `~` to
allow a difference up to the absolute tolerance.

```text
2026-01-01 balance
  Assets:Bank           1,000 USD
  Assets:Brokerage:Cash 1,000 USD ~ 0.05
```

See [Balance](./directives/balance.md).
