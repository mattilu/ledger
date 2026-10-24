# Account sign conventions

- **Status:** Proposed.
- **Supersedes:** None.

Ledger's fixed sign convention can make balances unintuitive: `Income`, `Equity`
and `Liabilities` accounts normally hold negative balances, contrary to common
double-entry accounting conventions. This proposal introduces features to let
users choose how balances are written and displayed.

## Background

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
use two columns. Instead, the convention is for positive amounts to be
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

The `Income:Salary` posting being negative is perhaps the most surprising thing
about Ledger. This sign convention derives for Beancount, from which Ledger was
inspired. It's explained in the following table:

| Account type | Normal balance side | Sign for debit | Sign for credit | Sign for normal-balance increase |
| ------------ | ------------------- | -------------- | --------------- | -------------------------------- |
| Assets       | Debit               | +              | -               | +                                |
| Liabilities  | Credit              | +              | -               | -                                |
| Equity       | Credit              | +              | -               | -                                |
| Income       | Credit              | +              | -               | -                                |
| Expenses     | Debit               | +              | -               | +                                |
| Trading      | Credit              | +              | -               | -                                |

And it comes from the following interpretation of the accounting equation:

$$ Assets + Liabilities + Equity + Income + Expenses + Trading = 0 $$

Which requires the postings of any transaction to sum to zero for each currency.

From the table, it derives that `Assets` and `Expenses` accounts would generally
hold positive balances, while `Liabilities`, `Equity` and `Income` would
generally hold negative balances.

### A note on `Trading` accounts

`Trading` accounts are used to keep the equation intact when multiple currencies
are used. In a table based ledger, a transaction to buy 1 ACME stock for 1000
USD would be written as:

| Date       | Description | Account                 | Debit    | Credit   |
| ---------- | ----------- | ----------------------- | -------- | -------- |
| 2026-01-03 | Buy Stock   | Assets:Brokerage:Stocks | 1 ACME   |          |
|            |             | Assets:Brokerage:Cash   |          | 1000 USD |
|            |             | Trading:Stocks          | 1000 USD | 1 ACME   |

In Ledger, this becomes:

```text
2026-01-03 * "Buy Stock"
  trading-account: Trading:Stocks
  Assets:Brokerage:Stocks    1 ACME  {{ 1000 USD }}
  ; Trading:Stocks          -1 AMCE  ; NOTE: automatically inserted by Ledger
  ; Trading:Stocks        1000 USD   ; NOTE: automatically inserted by Ledger
  Assets:Brokerage:Cash  -1000 USD
```

From this, it can be seen that `Trading` accounts generally hold negative
balances for "long" positions and positive balances for "short" ones, which can
also be confusing.

## Objective

Let users choose a sign convention and specify the normal-balance side for
exceptional accounts, making account signs more intuitive without changing the
underlying accounting.

For example, under a convention where an increase to any account's normal
balance is positive, the same transactions could be entered as:

```text
2026-01-01 * "Salary"
  Assets:Bank    1,000 USD
  Income:Salary  1,000 USD

2026-01-02 * "Grocery shopping"
  Expenses:Groceries       100 USD
  Liabilities:Credit-Card  100 USD
```

Alternatively, users could choose signs based on net-worth effect: positive for
increases and negative for decreases.

```text
2026-01-01 * "Salary"
  Assets:Bank    1,000 USD
  Income:Salary  1,000 USD

2026-01-02 * "Grocery shopping"
  Expenses:Groceries       -100 USD
  Liabilities:Credit-Card  -100 USD
```

## Requirements

### Core

1. **Preserve accounting invariants.** Transactions _MUST_ continue to balance
   to zero independently for each currency after amounts have been converted to
   the common internal sign basis. Costs, prices, inventory, and balance
   assertions _MUST_ retain their meaning; changing sign conventions _MUST NOT_
   change the underlying economic transaction.
2. **Preserve the internal representation.** From loading onward, account
   amounts and balances _MUST_ retain Ledger's canonical signed representation
   and accounting equation. User-authored amounts _SHOULD_ be converted when
   loaded and when presented. This allows library consumers to continue
   interpreting loaded and booked data without inspecting a convention setting,
   and conversion remains at the system boundaries rather than spreading through
   booking and reports.
3. **Backwards compatibility.** Existing ledger files _MUST_ retain their
   current behavior without requiring edits. The current convention must
   therefore remain the default.

### User

1. **Sign convention selection.** Users _SHOULD_ be able to select a sign
   convention and change it to affect subsequent directives.
2. **Per-account normal-balance overrides.** Users _SHOULD_ be able to override
   the normal-balance side implied by an account's family. This supports contra
   accounts such as `Income:Capital-Gains:Realized-Losses` and
   `Expenses:Credit-Card:Rebates`, whose normal side differs from ordinary
   accounts in those families.
3. **Consistent entry and output.** Each transaction and balance directive
   _MUST_ use the convention active when read. Transaction reports _MAY_ show
   each transaction in its entry convention. Account-bound reports _MUST_
   aggregate canonical balances, then display them using one selected report
   convention and each account's normal-balance side; they _MUST NOT_ sum
   transaction postings displayed under different conventions.

### Tooling

1. **Support future migration.** The implementation _SHOULD_ support a future
   tool that converts ledger files between conventions. This is a design
   constraint, not a requirement to expose display-only normalization or to
   include a migration command in the initial feature.

## Proposal

The proposal adds two complementary controls:

### `sign-convention` option

A new `sign-convention` option lets users choose how signed amounts represent
debits and credits. It follows existing option-scoping rules: each transaction
and balance directive uses the value active at its location, and a change only
affects subsequent directives, not earlier ones.

The option supports the following values:

- `legacy` or `beancount`: the current behavior and default if not set.
- `normal-balance-positive`: positive signs increase the normal balance for
  every account type.
- `net-worth-positive`: positive signs increase net worth (`Assets`, `Income`,
  and `Equity`); negative signs decrease it (`Liabilities` and `Expenses`).

Any other `sign-convention` value is a loading error reported at the source
`option` directive.

For each standard account type, the following table gives user-facing signs for
**debit** / **credit** / **normal-balance increase**, using the account type's
standard normal-balance side. `+` and `-` are the signs users enter and see.

| Account type | Normal balance | `legacy` / `beancount` | `normal-balance-positive` | `net-worth-positive` |
| ------------ | -------------- | ---------------------- | ------------------------- | -------------------- |
| Assets       | Debit          | + / - / +              | + / - / +                 | + / - / +            |
| Liabilities  | Credit         | + / - / -              | - / + / +                 | + / - / -            |
| Equity       | Credit         | + / - / -              | - / + / +                 | - / + / +            |
| Income       | Credit         | + / - / -              | - / + / +                 | - / + / +            |
| Expenses     | Debit          | + / - / +              | + / - / +                 | - / + / -            |
| Trading      | Credit         | + / - / -              | - / + / +                 | - / + / +            |

`Trading` accounts balance multi-currency entries and don't have a standard
debit/credit normal side, the mapping has been chosen to show long positions as
credits and short positions as debits.

When an account's normal-balance side is opposite its type's standard side (a
contra-account), the mappings are:

| Account type | Normal balance | `legacy` / `beancount` | `normal-balance-positive` | `net-worth-positive` |
| ------------ | -------------- | ---------------------- | ------------------------- | -------------------- |
| Assets       | Credit         | + / - / -              | - / + / +                 | + / - / -            |
| Liabilities  | Debit          | + / - / +              | + / - / +                 | + / - / +            |
| Equity       | Debit          | + / - / +              | + / - / +                 | - / + / -            |
| Income       | Debit          | + / - / +              | + / - / +                 | - / + / -            |
| Expenses     | Credit         | + / - / -              | - / + / +                 | - / + / +            |
| Trading      | Debit          | + / - / +              | + / - / +                 | - / + / -            |

### Per-account `normal-balance` side

An account may override the normal-balance side implied by its family through
`normal-balance: "debit"` or `normal-balance: "credit"` metadata on `open`. This
supports contra accounts without changing the account's family or the
`sign-convention` option active for a directive. An invalid value or metadata
type is a loading error reported at the `open` directive.

For example:

```text
2026-01-01 open Expenses:Credit-Card:Rebates
  normal-balance: "credit"

2026-01-01 open Income:Capital-Gains:Realized-Losses
  normal-balance: "debit"
```

## Design decisions

Each section below records a design decision and the alternatives considered.

### Normalize in loading; convert at output boundaries

Keep Ledger's existing signed amounts as the canonical representation exposed to
booking and library consumers. This preserves existing consumer expectations and
leaves booking behavior unchanged.

After collecting and ordering directives, the loading module runs a
normalization pass before returning the `Ledger`. The pass converts user-entered
account amounts, including balance assertions, and retains the sign convention
and normal-balance side needed to reproduce entry presentation. It also retains
the root file's final `sign-convention` value on the loaded `Ledger` as passive
presentation metadata for report defaults, falling back to `legacy` when unset.
Per-directive presentation context remains with the corresponding loaded
directives and is carried onto booked transactions. Booking also carries the
root report default into `BookedLedger` without interpreting either kind of
presentation metadata in booking logic, aside for error reporting of unbalanced
transactions and balance assertion failures.

This allows the same account to be used under different conventions in different
sections:

```text
option "sign-convention" "normal-balance-positive"

2026-01-01 * "Lunch"
  Expenses:Dining   50 USD
  Assets:Cash      -50 USD

option "sign-convention" "net-worth-positive"

2026-01-02 * "Lunch"
  Expenses:Dining  -50 USD
  Assets:Cash      -50 USD
```

> NOTE: After this change, user-facing postings need not visibly sum to zero.
> Their canonical amounts must still balance per currency, and documentation and
> reports must not imply otherwise.

Costs and prices remain values, not account balances, and must not be
canonicalized or converted.

Every input and output path must follow this model, including generated
postings, `Trading`, inferred amounts, filters, and report calculations.

#### Rejected alternative: Change the booking model

Make the selected convention part of booking's account-balance and inventory
semantics, rather than translating at the boundaries.

This could make internal balances match users' preferred signs directly, but
would affect transaction balancing, inventory, costed positions, assertions,
generated postings, and reports. It would also require library consumers to know
the active convention, contrary to the requirement to preserve the current
internal representation and behavior.

#### Rejected alternative: Display-only account normalization

Changing only how balances are displayed would leave users writing transactions
and balance assertions in the original convention. It could also mislead users
who assume displayed signs are valid input signs. The proposal instead applies
the active convention to input directives and converts canonical aggregates for
account-bound reports.

### Directive and report presentation

Account-bound reports, including inventory and balance summaries, aggregate
canonical account balances and convert each aggregate using one report
convention and the account's current normal-balance side. The default is the
final `sign-convention` state on the root frame after loading; changes inside
included files do not affect it. If the root file never sets the option,
including when it is empty, the default is `legacy`. Reports may override the
convention explicitly. Changing an account's normal side may change a displayed
balance's sign without changing the balance internally. Account-bound reports
may override this default through a report option; corresponding CLI flags
should expose that option where the report is available from the CLI.

Inventory reports retain their existing aggregation and cost-display options.
Those operations continue to act on canonical inventory data; sign conversion is
presentation-only and applies to the displayed position quantities using the
effective normal-balance side of each displayed account. Position costs are not
account balances and are not sign-converted. A parent total is aggregated from
canonical descendant positions and displayed using the parent's effective
normal-balance side, so its displayed sign may differ from a child with a
different side.

Tree reports must not display an aggregate balance at the synthetic root of the
account tree: it is not an account and has no account type or normal-balance
side. Do not infer its side from its children, even when there is only one
top-level account family, since adding another family must not change the
meaning of the root. Show totals at real account nodes using each node's
effective normal-balance side; keep top-level account-family totals separate. If
a report needs a ledger-wide total, it must define and label that as a separate
measure rather than presenting it as a root account balance.

By default, transaction-oriented reports show each transaction using the
convention and account sides active at entry. This includes authored, generated,
and inferred postings. A running balance, if shown, uses the convention and
effective side of the transaction and posting being displayed, rather than
preserving the conventions of all earlier transactions contributing to it.
Reports may instead offer one report-wide convention or a debit/credit-column
style that shows normalized accounting effects independently of the entry
convention.

### Transaction balance diagnostics

Balance diagnostics distinguish transaction residuals from account-specific
values. A failed transaction reports its residual in the canonical basis. It
also shows the amount needed to offset that residual as an illustrative posting
to the account of the last user-authored posting of the transaction. Booking
errors must retain enough source posting and presentation context to render this
example even though no booked transaction is produced. Implicit generated
postings are not considered when selecting the last authored posting, but
user-authored Transaction postings are. Display the illustrative amount using
the convention active for the transaction and the resolved sign convention for
that posting's account. This illustration is not a generated posting or a
recommended correction.

For example, consider a salary transaction that debits `100 USD` to
`Assets:Bank` and credits `90 USD` to `Income:Salary`. The user-entered income
sign depends on the convention:

```text
; legacy
Assets:Bank     100 USD
Income:Salary   -90 USD

; net-worth-positive
Assets:Bank     100 USD
Income:Salary    90 USD
```

Both normalize to the same canonical transaction and have a canonical residual
of `+10 USD`. Because `Income:Salary` is the last source-order posting and has a
credit normal balance, the illustrative posting is shown in that account using
the transaction's active convention:

```text
; legacy
Residual: +10 USD
Example fix:  Income:Salary  -10 USD

; net-worth-positive
Residual: +10 USD
Example fix:  Income:Salary  10 USD
```

The displayed signs differ, but both illustrative postings represent the same
canonical credit adjustment. The account is shown to make the diagnostic more
actionable, not to prescribe that this is the account the user should change.

### Balance assertions

A failed balance assertion reports its expected amount, actual balance, and
delta using the convention active for the assertion and the account's resolved
normal-balance side.

### Per-account normal-balance overrides

Use `normal-balance: "debit"` or `normal-balance: "credit"` metadata on the
`open` directive to override the side implied by an account's family. This
supports, for example, credit-normal `Expenses:Credit-Card:Rebates` and
debit-normal `Income:Capital-Gains:Realized-Losses`. The active sign convention
still maps signs to debits and credits; the override describes only the
account's normal side.

The account normal-balance side is resolved using the state at the time of the
directive that requires it, using the `normal-balance` metadata on the account's
`open` directive or, for undeclared accounts or when the metadata is missing,
that of its closest ancestor, falling back to the default side of the account's
type. It follows that changing an ancestor's setting can affect subsequent
directives for descentants without a more specific setting. This is intentional.

Closing an account does not clear its setting; it continues to apply to later
directives, including assertions, while the account remains closed. On
reopening, an explicit `normal-balance` value replaces the account's prior
setting. If the reopening `open` has no such value, the prior account-specific
setting is cleared.

#### Rejected alternative: Attach the sign convention to accounts

An account-scoped convention would prevent the same account from using different
input conventions in separate files or sections, and changing it would require
updating account state even when the account has a balance. It also conflates
the account's normal side with the convention used to write a directive.
Therefore, each transaction and balance directive uses the convention active at
its location; reports follow the transaction-oriented or account-bound rules
described above.

#### Rejected alternative: Choose what a plus sign means

Specifying whether `+` means debit or credit would make the account override
compete with the active convention's mapping and ask users to configure sign
presentation. The selected model keeps the concerns separate: the account
supplies its normal side, and the active sign convention maps that side to
signs.

#### Rejected alternative: Choose the sign of a normal-balance increase

Specifying whether a normal-balance increase is positive or negative would tie
the account override to sign presentation and could contradict the
`normal-balance-positive` convention. A `debit` or `credit` side supports contra
accounts while preserving one consistent mapping.

#### Rejected alternative: Mark the account as contra

A boolean `contra` marker would express only the inverse of the family default
and is less explicit than naming the side that normally increases the account.
The `debit`/`credit` setting also supports exceptions that are not contra
accounts, without a separate flag or special case.

### Custom sign mappings: deferred

The initial feature supports the three named conventions only; users cannot
define custom sign conventions for individual account types. Adding custom
mappings now would expand configuration and validation beyond the immediate use
cases. However, the shared sign-mapping model should make future per-type
mappings possible without changing booking semantics or the canonical
representation.

### Ledger-file conversion: deferred

A separate CLI operation to convert a ledger between conventions is outside the
initial feature. The core sign mapping should nevertheless be explicit and
reusable so a future conversion tool can rewrite postings, balance assertions,
and other convention-sensitive amounts while preserving transaction balancing
and the meaning of inferred postings. If implemented, the tool should emit a
converted copy by default rather than overwrite source files, preserving the
original ledger and avoiding destructive handling of included files, comments,
and formatting.
