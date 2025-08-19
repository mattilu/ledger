import { subcommands } from 'cmd-ts';

import { debug } from './debug.js';
import { report } from './report.js';
import { validate } from './validate.js';

export const app = subcommands({
  name: 'ledger',
  cmds: {
    debug,
    report,
    validate,
  },
});
