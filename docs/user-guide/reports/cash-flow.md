# Cash-flow report

The `cash-flow` report accumulates postings to selected accounts from
transactions on or after an optional start date. By default, it selects accounts
under `Assets` and `Liabilities`. It reports the cumulative movements in those
accounts, not a categorized income/expense statement.

```bash
npm run -s main -- report cash-flow main.ledger \
  --date-from 2026-01-01 --date 2026-03-31
```

`--date-from` includes transactions on the specified date. The shared `--date`
option limits all Ledger directives processed to that date, inclusive.

## Options

| Option                    | Short | Behavior                                                                                                                           |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--date DATE`             | `-D`  | Process Ledger directives through `DATE`, inclusive.                                                                               |
| `--date-from DATE`        | `-d`  | Include transactions on or after this date.                                                                                        |
| `--account REGEX`         | `-a`  | Select accounts matching this case-insensitive regular expression. Repeat to add alternatives.                                     |
| `--exclude-account REGEX` | `-A`  | Exclude accounts matching this case-insensitive regular expression. Repeat to add alternatives.                                    |
| `--currency REGEX`        | `-c`  | Select postings whose commodity or cost currency matches this case-insensitive regular expression. Repeat to add alternatives.     |
| `--show-from`             | `-f`  | Also show postings to the other accounts as “From accounts”.                                                                       |
| `--hide-cost`             | `-C`  | Omit cost basis from displayed positions.                                                                                          |
| `--tree`                  | `-t`  | Display accounts as a hierarchy.                                                                                                   |
| `--totals`                | `-T`  | Show descendant totals on parent accounts; only applies with `--tree`.                                                             |
| `--max-depth N`           | `-M`  | Limit displayed tree depth; only applies with `--tree`. Elided descendants are included in the nearest displayed ancestor's total. |

The default account filter selects account names beginning with `Assets:` or
`Liabilities:`. The regular expressions are case-insensitive, anchored to the
full account or currency name, and repeated patterns are treated as
alternatives. A transaction contributes to the report when it has at least one
selected posting.

With `--show-from`, the “From accounts” section shows the complementary postings
for transactions that contributed selected postings. Without it, those
complementary postings are not displayed.

## Example

Report cash movements in bank accounts while exposing the accounts on the other
side of those transactions:

```bash
npm run -s main -- report cash-flow main.ledger \
  --date-from 2026-01-01 --date 2026-03-31 \
  --account 'Assets:Bank:.*' --show-from
```

See [Reports](./index.md), [Commands](../commands.md), and
[Booking](../booking.md).
