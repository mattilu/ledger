import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  alt,
  apply,
  buildLexer,
  expectEOF,
  opt_sc,
  rep_sc as upstreamRepSc,
  seq,
  tok,
} from 'typescript-parsec';

import { rep_sc } from './combinators.js';

enum Kind {
  A,
  B,
  Space,
}

const lexer = buildLexer([
  [true, /^a/g, Kind.A],
  [true, /^b/g, Kind.B],
  [false, /^\s+/g, Kind.Space],
]);

describe('rep_sc', () => {
  test('matches empty, single, and multiple elements identically to upstream', () => {
    const item = apply(tok(Kind.A), t => t.text);
    const ours = rep_sc(item);
    const theirs = upstreamRepSc(item);

    for (const input of ['', 'a', 'a a a a a', 'a a b']) {
      const tokens = lexer.parse(input);
      assert.deepEqual(ours.parse(tokens), theirs.parse(tokens));
    }
  });

  test('ignores zero-width candidates without infinite looping', () => {
    const maybeA = opt_sc(apply(tok(Kind.A), t => t.text));
    const ours = rep_sc(maybeA);
    const theirs = upstreamRepSc(maybeA);

    for (const input of ['', 'a a', 'b']) {
      const tokens = lexer.parse(input);
      assert.deepEqual(ours.parse(tokens), theirs.parse(tokens));
    }
  });

  test('preserves all candidates and prefixes on ambiguous grammars', () => {
    // Ambiguous item: matches either single 'a' or pair 'a a'
    const ambiguous = alt(
      apply(tok(Kind.A), () => '1'),
      apply(seq(tok(Kind.A), tok(Kind.A)), () => '2'),
    );
    const ours = rep_sc(ambiguous);
    const theirs = upstreamRepSc(ambiguous);

    for (const input of ['a', 'a a', 'a a a', 'a a a a']) {
      const tokens = lexer.parse(input);
      const got = ours.parse(tokens);
      const want = theirs.parse(tokens);
      assert.deepEqual(got, want);
    }

    // Also check mixed unambiguous prefix + ambiguous branch + unambiguous suffix
    const prefix = lexer.parse('a a a a a');
    const gotEof = expectEOF(ours.parse(prefix));
    const wantEof = expectEOF(theirs.parse(prefix));
    assert.deepEqual(gotEof, wantEof);
  });

  test('handles large repetitions linearly', () => {
    const count = 10_000;
    const input = 'a '.repeat(count);
    const tokens = lexer.parse(input);
    const out = rep_sc(apply(tok(Kind.A), t => t.text)).parse(tokens);
    assert.equal(out.successful, true);
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].result.length, count);
  });
});
