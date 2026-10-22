# `load`

`load` includes another Ledger file in the current load. A relative path is
resolved from the directory of the file containing the directive. `*` wildcards
are expanded, and matched paths are loaded in lexicographic order.

Each included file inherits the including file's current option state as a
starting point. Changes made inside the included file stay in that file's
evaluation frame and its nested loads.

A file cannot be loaded more than once; repeating a path or creating a cycle is
reported as a circular-load error.

Organize files by stable, intentional names if glob order matters. A common
pattern is to load account declarations before transaction files:

```text
load "setup/accounts.ledger"
load "2026/*.ledger"
```

See the [`load` syntax](../syntax.md#load), the
[getting-started guide](../getting-started.md#organizing-large-ledgers), and
[Options](../options.md) for option scoping.
