# `option`

An `option` changes how the loader interprets subsequent Ledger content or how
booking evaluates subsequent dated directives. Options are quoted name/value
pairs. Their supported names, defaults, and effects are listed in
[Options](../options.md).

Option state is positional: a directive captures the option values that were
active when it was loaded. Changing an option later does not retroactively
change earlier directives.

When a file is loaded, it starts with the current option state. An option set
inside that loaded file affects directives in that file and files it loads, but
does not flow back to the file that included it.

## Practical guidance

- Put file-wide options near the start of the main file, before the directives
  they should affect.

See the [`option` syntax](../syntax.md#option) and the
[Options reference](../options.md).
