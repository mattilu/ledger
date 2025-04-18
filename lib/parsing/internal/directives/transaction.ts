import { apply, opt_sc, rep_sc, seq, tok } from 'typescript-parsec';

import {
  PostingSpec,
  TransactionDirectiveSpec,
} from '../../spec/directives/transaction.js';
import { accountParser } from '../account.js';
import { amountParser } from '../amount.js';
import { dateParser } from '../date.js';
import { makeSourcePosition } from '../source-position.js';
import { stringParser } from '../string.js';
import { TokenKind } from '../tokenizer.js';

const postingParser = apply(
  seq(accountParser, opt_sc(amountParser)),
  ([account, amount]): PostingSpec => ({
    account,
    amount: amount ?? null,
  }),
);

export const transactionDirectiveParser = apply(
  seq(dateParser, tok(TokenKind.Star), stringParser, rep_sc(postingParser)),
  ([date, , description, postings], tokenRange): TransactionDirectiveSpec => ({
    type: 'transaction',
    date,
    description,
    postings,
    srcPos: makeSourcePosition(tokenRange),
  }),
);
