# Getting Started

## Introduction

Welcome to Ledger! This guide shows you how to create your first Ledger file,
organize your data, and run reports.

Ledger helps you track your finances in a plain-text format that is both
human-readable and machine-parsable.

## Prerequisites

Make sure you have followed the [Installation](./installation.md) guide.

## Writing your first Ledger file

Create a text file named `main.ledger` with the following content:

```text
option "account-reference-checks" "strict"

2026-01-01 open Assets:Bank
2026-01-01 open Equity:Opening-Balances

2026-01-02 * "Opening Balances"
  Assets:Bank          1,000 USD
  Equity:Opening-Balances
```

### What is happening here?

- **`option`**: This directive configures Ledger behavior. In this example,
  setting `account-reference-checks` to `strict` ensures that all referenced
  accounts have been explicitly declared using `open`.
- **`open`**: This directive tells Ledger to declare an account. It is good
  practice to use `strict` reference checks and declare all accounts with an
  `open` directive before referencing them, as this helps catch typos.
- **`*`**: This is a shorthand for the `txn` (transaction) directive. It
  introduces a transaction.
- **Account Names**: Note the hierarchical structure (e.g., `Assets:Bank`).
- **Transaction**: The transaction on `2026-01-02` adds 1,000 USD to the
  `Assets:Bank` account, with a matching posting on the
  `Equity:Opening-Balances` account, generally used to set up the initial state.

## Syntax Quick Reference

To keep your file valid, adhere to these core rules:

| Element        | Rule                                                                                                                                                                                                  | Example                        |
| :------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------- |
| **Currencies** | Must contain at least two characters, start with a capital letter, and contain only capital letters, digits, `.`, `-`, and `_`. Symbols such as `$` and `€` are not allowed.                          | `USD`, `EUR`                   |
| **Accounts**   | Requires at least two components separated by `:`. The first must be a standard category. Each component must start with a capital letter or digit and can only contain letters, digits, `-` and `_`. | `Assets:Cash`, `Expenses:Food` |
| **Categories** | Must be one of: `Assets`, `Liabilities`, `Income`, `Expenses`, `Equity`, or `Trading`.                                                                                                                |                                |
| **Dates**      | Must be in `YYYY-MM-DD` format.                                                                                                                                                                       | `2025-12-31`                   |
| **Strings**    | Descriptions must be enclosed in double quotes.                                                                                                                                                       | `"Grocery Shopping"`           |

## Running `ledger`

Once your file is ready, you can use the `ledger` CLI to interact with it.

### Validate your file

Before generating reports, ensure your syntax and logic are correct:

```bash
npm run -s main -- validate main.ledger
```

If the file is valid, the command exits without output. Otherwise, the `ledger`
CLI reports the source location and cause of the error.

### Generate a report

To see the current state of your accounts, generate an **inventory report**:

```bash
npm run -s main -- report inventory main.ledger
```

For more reporting options, see the [Reports](./reports/index.md) page.

## Organizing Large Ledgers

As your Ledger data grows, a single file can become difficult to manage. Use the
`load` directive to split it into smaller files.

### Recommended Structure

A common pattern is to use a `main.ledger` file that pulls in other specialized
files:

**`main.ledger`**

```text
option "account-reference-checks" "strict"

load "setup/accounts.ledger"
load "setup/currencies.ledger"
load "2026.ledger"
```

This setup allows you to keep your account definitions and currency settings
separate from your daily transactions.

**`setup/accounts.ledger`**

```text
2026-01-01 open Assets:Bank:Foo
2026-01-01 open Assets:Brokerage:Bar
2026-01-01 open Equity:Opening-Balances
```

**`setup/currencies.ledger`**

```text
1792-04-02 currency USD
  format-decimals: 2

1999-01-01 currency EUR
  format-decimals: 2
```

**`2026.ledger`**

```text
2026-01-02 * "Opening Balances"
  Assets:Bank          1,000 USD
  Equity:Opening-Balances
```

### Globbing

You can use the `*` wildcard to automatically include all matching files. For
example, if you store monthly transactions in separate files:

**`main.ledger`**

```text
load "2026/*.ledger"
```

This will automatically include any `.ledger` files located within the `2026/`
directory, so you can just add a new file at the beginning of each month.

### Closing Accounts

When an account is no longer active (e.g., you close a bank account), use the
`close` directive. This prevents accidental entries into a defunct account.

```text
2026-02-01 * "Closing old bank account"
  Assets:Bank:Old 1,000 USD
  Assets:Bank:New

2026-02-01 close Assets:Bank:Old
```

## Next Steps

See the following documentation:

- [Syntax](./syntax.md) for Ledger language syntax.
- [Directives](./directives/index.md) for available directives and their
  behavior.
- [Options](./options.md) for configurable Ledger behavior.
- [Cookbook](./cook-book.md) for examples of common patterns.
- [Booking](./booking.md) for accounting rules.
- [Commands](./commands.md) for command line usage.
- [Reports](./reports/index.md) for available reports.
