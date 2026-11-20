import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { either as E } from 'fp-ts';

import { parseSyntax, parseSyntaxResilient } from './parser.js';

await describe('syntax parser', async () => {
  await test('preserves standalone, inline, interior, and EOF comments with blank lines', () => {
    const src = [
      '; file header',
      '',
      '2026-04-01 * "Groceries" ; header inline',
      '  ; before first posting',
      '  Expenses:Food  1,250.50 CHF ; inline food',
      '',
      '  Assets:Bank',
      '',
      '; trailing file comment',
      '',
    ].join('\n');

    const res = parseSyntax(src);
    assert(E.isRight(res));
    const tree = res.right;

    assert.equal(tree.directives.length, 1);
    const txn = tree.directives[0];
    assert.equal(txn.type, 'transaction');

    assert.deepEqual(
      txn.date.dateToken.leadingTrivia.map(t =>
        t.kind === 'comment' ? t.text : `blank:${t.count}`,
      ),
      ['; file header', 'blank:1'],
    );
    assert.equal(txn.descriptionToken.trailingComment?.text, '; header inline');

    const [p1, p2] = txn.postings;
    assert.equal(p1.type, 'account-posting');
    assert.deepEqual(
      p1.accountToken.leadingTrivia.map(t =>
        t.kind === 'comment' ? t.text : `blank:${t.count}`,
      ),
      ['; before first posting'],
    );
    assert.equal(
      p1.amount?.currencyToken.trailingComment?.text,
      '; inline food',
    );
    assert(p1.amount?.amount.type === 'literal');
    assert.equal(p1.amount.amount.token.text, '1,250.50');

    assert.equal(p2.type, 'account-posting');
    assert.deepEqual(
      p2.accountToken.leadingTrivia.map(t =>
        t.kind === 'comment' ? t.text : `blank:${t.count}`,
      ),
      ['blank:1'],
    );

    assert.deepEqual(
      tree.eofTrivia.map(t =>
        t.kind === 'comment' ? t.text : `blank:${t.count}`,
      ),
      ['blank:1', '; trailing file comment'],
    );
  });

  await test('preserves explicit parentheses, item order, and exact spans', () => {
    const src = [
      '2026-05-01 txn "Order & parens"',
      '  k2: "second"',
      '  k1: "first"',
      '  Assets:Broker  (1 + 2) * 3 ACME { "lot-a", 2026-01-01, 10 USD }',
      '  choose account { when (direction is debit): Assets:Cash, }',
      '',
    ].join('\n');

    const res = parseSyntax(src);
    assert(E.isRight(res));
    const [txn] = res.right.directives;
    assert.equal(txn.type, 'transaction');
    assert.equal(txn.flagToken.text, 'txn');
    assert.deepEqual(
      txn.metadata.map(m => m.keyToken.text),
      ['k2', 'k1'],
    );

    const p1 = txn.postings[0];
    assert.equal(p1.type, 'account-posting');
    assert(p1.amount !== null);
    assert.equal(p1.amount.amount.type, 'binary');
    assert.equal(p1.amount.amount.lhs.type, 'paren');
    assert.equal(
      src.slice(p1.amount.span.start.offset, p1.amount.span.end.offset),
      '(1 + 2) * 3 ACME',
    );

    assert(p1.costSpec !== null);
    assert.deepEqual(
      p1.costSpec.items.map(i => i.value.kind),
      ['tag', 'date', 'amount'],
    );

    const p2 = txn.postings[1];
    assert.equal(p2.type, 'account-choice-posting');
    assert.equal(p2.target.type, 'inline');
    const [clause] = p2.target.block.clauses;
    assert.equal(clause.type, 'when');
    assert.equal(clause.condition.type, 'paren');
    assert(clause.commaToken !== null);
  });

  await test('recovers across unlexable tokens and broken postings in resilient mode', () => {
    const src = [
      'option ?bad',
      '',
      '2026-06-01 * "Broken middle posting"',
      '  Expenses:Food  10',
      '  Assets:Cash   -10 CHF',
      '',
      '2026-06-02 08:30 Z open Assets:Cash CHF',
      '',
    ].join('\n');

    const strictRes = parseSyntax(src);
    assert(E.isLeft(strictRes));
    assert.match(
      strictRes.left.message,
      /^Unable to tokenize the rest of the input: \?bad/,
    );

    const tree = parseSyntaxResilient(src);
    assert.equal(tree.directives.length, 3);
    assert.equal(tree.directives[0].type, 'error');

    const txn = tree.directives[1];
    assert.equal(txn.type, 'transaction');
    assert.equal(txn.postings.length, 3);
    assert.equal(txn.postings[0].type, 'account-posting');
    assert.equal(txn.postings[1].type, 'error');
    assert.equal(txn.postings[2].type, 'account-posting');
    assert.equal(txn.postings[2].accountToken.text, 'Assets:Cash');

    const openDir = tree.directives[2];
    assert.equal(openDir.type, 'open');
    assert.equal(openDir.accountToken.text, 'Assets:Cash');
  });

  await test('handles CRLF line endings cleanly in comments and token spans', () => {
    const crlfSrc =
      '; header comment\r\n2026-06-01 open Assets:Cash CHF ; inline note\r\n';
    const res = parseSyntax(crlfSrc);
    assert(E.isRight(res));
    const dir = res.right.directives[0];
    assert.equal(dir.type, 'open');
    assert.deepEqual(
      dir.date.dateToken.leadingTrivia.map(t =>
        t.kind === 'comment' ? t.text : t.kind,
      ),
      ['; header comment'],
    );
    assert.equal(dir.date.dateToken.span.start.row, 2);
    assert.equal(dir.date.dateToken.span.start.col, 1);
    assert.equal(dir.currencyTokens[0].trailingComment?.text, '; inline note');
  });
});
