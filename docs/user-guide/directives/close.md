# `close`

`close` marks an account as closed from its date. Ordinary postings to a closed
account fail booking. A later `open` directive may reopen it; closing an
already-closed account without reopening first is an error.

The `none` value of `account-reference-checks` disables account-state checks,
including the closed-account posting check. In the default `lenient` and
`strict` modes, postings to closed accounts are rejected. See
[Options](../options.md).

Closing an account does not itself remove or zero its positions. Use a
transaction before closing to transfer or settle any remaining balance.

See the [`close` syntax](../syntax.md#close) and [Open](./open.md).
