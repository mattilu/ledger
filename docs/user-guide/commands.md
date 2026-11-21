# CLI commands

Run the CLI from the repository with:

```bash
npm run -s main -- <command> [arguments] [options]
```

When installed as a package, use `npx ledger` in place of `npm run -s main --`.
Use `--help` on the CLI or a command to see its usage.

## Commands

### `validate <file>`

Loads and books a ledger without producing a report. A successful validation
exits without output; a parse, load, or booking error is reported with its
source location.

```bash
npm run -s main -- validate main.ledger
```

### `debug <file> --line N`

Prints the nearest preceding loaded directive and its booked transaction state
for a source line. By default, the source file is the input Ledger file.

| Option        | Short | Description                                                 |
| ------------- | ----- | ----------------------------------------------------------- |
| `--file FILE` | `-f`  | Source file containing the directive. Defaults to `<file>`. |
| `--line N`    | `-l`  | Source line number to inspect.                              |

```bash
npm run -s main -- debug main.ledger --line 42
npm run -s main -- debug main.ledger --file entries/2026.ledger --line 12
```

### `fmt [files...]`

Formats Ledger files while preserving all comments and exact numeric values.
When `[files...]` is omitted or `-`, `fmt` reads from standard input and writes
formatted output to standard output. When a single file is given without
`--write` or `--check`, formatted output is printed to standard output.

Configuration is discovered automatically by walking upward from the target file
directory (or `--stdin-filepath`) for `.ledgerfmt.json`, or loaded from an
explicit `--config` path. CLI flags override `.ledgerfmt.json` settings.

| Option / Flag                             | Short | Description                                                                                 |
| ----------------------------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `--write`                                 | `-w`  | Format files in place (writes only when content changes).                                   |
| `--check`                                 | `-c`  | Check if inputs are formatted; exits with status `1` if any input requires reformatting.    |
| `--config PATH`                           |       | Explicit path to a `.ledgerfmt.json` configuration file.                                    |
| `--stdin-filepath PATH`                   |       | Virtual file path used for `.ledgerfmt.json` discovery and diagnostics when formatting `-`. |
| `--indent-width N`                        |       | Spaces per indentation level (default: `2`).                                                |
| `--print-width N`                         |       | Target maximum line width for wrappable constructs (default: `88`).                         |
| `--align-scope SCOPE`                     |       | `none`, `directive` (default), `file`, `file-grow-only`, or `fixed`.                        |
| `--align-mode MODE`                       |       | `currency` (default), `decimal`, or `decimal-and-currency`.                                 |
| `--align-column N`                        |       | Target 1-based anchor column in `fixed` scope (`52` when `0`), or minimum floor column.     |
| `--max-align-column N`                    |       | Optional maximum anchor column cap for `file` and `file-grow-only` scopes.                  |
| `--min-gap-spaces N`                      |       | Minimum spaces between an account name and its amount (default: `2`).                       |
| `--align-trailing-comments[=true\|false]` |       | Align inline `;` comments vertically across sibling rows in a directive (default: `false`). |
| `--thousands-separator MODE`              |       | `preserve` (default), `add`, or `remove` `,` separators in integer digits.                  |
| `--transaction-flag-style STYLE`          |       | `preserve` (default), `star` (`*`), or `txn` for non-`!` transactions.                      |
| `--currency-keyword-style STYLE`          |       | `preserve` (default), `currency`, or `commodity`.                                           |
| `--trailing-comma STYLE`                  |       | `multiline` (default), `always`, or `never` in rule blocks.                                 |

Top-level `; ledger-fmt: off` and `; ledger-fmt: on` comments suspend and resume
formatting for specific sections of a file.

```bash
npm run -s main -- fmt --write main.ledger entries/*.ledger
npm run -s main -- fmt --check main.ledger
npm run -s main -- fmt --stdin-filepath main.ledger < main.ledger
```

Example `.ledgerfmt.json`:

```json
{
  "alignScope": "file-grow-only",
  "alignMode": "decimal-and-currency",
  "thousandsSeparator": "preserve",
  "alignTrailingComments": true
}
```

### `report <report-type> <file>`

Generates one of the supported reports: `inventory`, `cash-flow`,
`transactions`, or `unrealized-pnl`. Each report accepts `--date` (`-D`) to
process directives through a date, inclusive. For report-specific date, filter,
and formatting options, see the [reports reference](./reports/index.md) and the
page for the report you plan to run.

```bash
npm run -s main -- report inventory main.ledger
npm run -s main -- report transactions main.ledger --flag '!'
```

The available reports are:

- [Inventory](./reports/inventory.md)
- [Cash-flow](./reports/cash-flow.md)
- [Transactions](./reports/transactions.md)
- [Unrealized P&L](./reports/unrealized-pnl.md)
