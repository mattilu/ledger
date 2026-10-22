# `currency`

The `currency` directive declares a currency or commodity and attaches metadata
used by the application. A declaration is not required to use a currency in an
amount, but it is required to attach currency metadata. A currency name can only
be defined once in the loaded Ledger file; a second declaration is a load error.

The currently supported metadata key is:

| Metadata          | Type   | Effect                                                                                                                               |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `format-decimals` | Number | Formats amounts in this currency to the given number of decimal places in reports. It affects display, not the exact internal value. |

Example:

```text
1792-04-02 currency USD
  format-decimals: 2
```

No declaration means report formatting does not apply currency-specific
rounding. The `commodity` keyword has the same behavior; see
[Commodity](./commodity.md).

See the [`currency` syntax](../syntax.md#currency--commodity).
