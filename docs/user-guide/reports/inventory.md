# Inventory report

The `inventory` report shows the booked positions held in each account.
Positions with a cost basis include that cost by default. To inspect the ledger
only through a particular date, use the shared `--date` option. Position
quantities use the report's sign convention; cost basis values are unchanged. By
default, the convention is the final `sign-convention` value in the root Ledger
file, or `legacy` if none is set. Use `--sign-convention` to override the
default.

```bash
npm run -s main -- report inventory main.ledger
npm run -s main -- report inventory main.ledger --date 2026-06-30
```

## Options

| Option                    | Short | Behavior                                                                                                                                   |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--date DATE`             | `-D`  | Process Ledger directives through `DATE`, inclusive.                                                                                       |
| `--sign-convention NAME`  | —     | Override the sign convention used to display amounts.                                                                                      |
| `--account REGEX`         | `-a`  | Include accounts matching this case-insensitive regular expression. Repeat to add alternatives.                                            |
| `--exclude-account REGEX` | `-A`  | Exclude accounts matching this case-insensitive regular expression. Repeat to add alternatives. Exclusions take precedence over inclusion. |
| `--currency REGEX`        | `-c`  | Include positions whose commodity or cost currency matches this case-insensitive regular expression. Repeat to add alternatives.           |
| `--hide-cost`             | `-C`  | Show position amounts without their cost basis.                                                                                            |
| `--tree`                  | `-t`  | Display accounts as a hierarchy.                                                                                                           |
| `--totals`                | `-T`  | Show descendant totals on parent accounts; only applies with `--tree`.                                                                     |
| `--max-depth N`           | `-M`  | Limit displayed tree depth; only applies with `--tree`. Elided descendants are included in the nearest displayed ancestor's total.         |

An empty filter is not restrictive: without account or currency filters, all
accounts and positions are eligible. Multiple account or currency expressions
are alternatives; account inclusion and currency filtering both apply when
specified.

## Example

Show only brokerage holdings as a tree, retaining cost basis and showing parent
totals:

```bash
npm run -s main -- report inventory main.ledger \
  --account 'Assets:Brokerage:.*' --tree --totals
```
