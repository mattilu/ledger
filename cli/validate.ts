import { command, positional, string } from 'cmd-ts';
import { either as E, function as F } from 'fp-ts';

import { book } from '../lib/booking/booking.js';
import { load } from '../lib/loading/loader.js';
import { CommandError } from './error.js';

export const validate = command({
  name: 'validate',
  description: 'Validates a ledger file',
  args: {
    inputFile: positional({
      displayName: 'file',
      type: string,
      description: 'Input ledger file to process',
    }),
  },
  handler: async ({ inputFile }): Promise<E.Either<CommandError, void>> => {
    return F.pipe(
      await load(inputFile),
      E.mapLeft(CommandError.fromLoadError),
      E.flatMap(F.flow(book, E.mapLeft(CommandError.fromBookingError))),
      E.asUnit,
    );
  },
});
