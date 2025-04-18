import { subcommands } from 'cmd-ts';

import { debug } from './debug.js';

export const app = subcommands({
  name: 'ledger',
  cmds: {
    debug,
  },
});
