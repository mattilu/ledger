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

  await test('preserves both comments separated by a lone CR without overwriting trailing comments', () => {
    const crSrc =
      '2026-06-01 * "Coffee" ; first\r; second\n  Assets:Cash  10 USD\n';
    const res = parseSyntax(crSrc);
    assert(E.isRight(res));
    const txn = res.right.directives[0];
    assert.equal(txn.type, 'transaction');
    assert.equal(txn.descriptionToken.trailingComment?.text, '; first');
    const firstPosting = txn.postings[0];
    assert.equal(firstPosting.type, 'account-posting');
    assert.deepEqual(
      firstPosting.accountToken.leadingTrivia.map(t =>
        t.kind === 'comment' ? t.text : t.kind,
      ),
      ['; second'],
    );
    assert.equal(firstPosting.accountToken.span.start.row, 3);
  });

  await test('sanitizes control and ANSI escape characters in lexical error messages', () => {
    const res = parseSyntax('option \x1b[31mred\x1b[0m\n');
    assert(E.isLeft(res));
    assert(!res.left.message.includes('\x1b'));
    assert(res.left.message.includes('\\x1b[31mred'));
  });

  await test('rejects deeply nested expressions and conditions without stack overflow', () => {
    const deepExpr = `2026-06-01 * "Deep"\n  Assets:Cash  ${'('.repeat(400)}1${')'.repeat(400)} USD\n`;
    const exprRes = parseSyntax(deepExpr);
    assert(E.isLeft(exprRes));

    const resilientExpr = parseSyntaxResilient(deepExpr);
    assert.equal(resilientExpr.directives.length, 1);

    const deepCond = `account-rule "deep" {\n  when ${'not '.repeat(400)}direction is debit: Assets:Cash\n}\n`;
    const condRes = parseSyntax(deepCond);
    assert(E.isLeft(condRes));

    const resilientCond = parseSyntaxResilient(deepCond);
    assert.equal(resilientCond.directives.length, 1);
  });

  await test('reports accurate start and end UTF-16 offsets on syntax error spans', () => {
    const src = '2026-01-01 unknown-directive Assets:Cash\n';
    const res = parseSyntax(src);
    assert(E.isLeft(res));
    assert(res.left.span !== undefined);
    assert.equal(res.left.span.start.offset, 11);
    assert.equal(res.left.span.end.offset, 28);
    assert.equal(
      src.slice(res.left.span.start.offset, res.left.span.end.offset),
      'unknown-directive',
    );
  });

  await test('skips broken inline choose account blocks as a single error posting without misparsing inner accounts', () => {
    const src = [
      '2026-06-01 * "Broken inline rule"',
      '  choose account {',
      '    when ???: Assets:Cash',
      '  }',
      '  Expenses:Food  10 USD',
      '',
    ].join('\n');

    const tree = parseSyntaxResilient(src);
    assert.equal(tree.directives.length, 1);
    const txn = tree.directives[0];
    assert.equal(txn.type, 'transaction');
    assert.equal(txn.postings.length, 2);
    assert.equal(txn.postings[0].type, 'error');
    assert.equal(txn.postings[1].type, 'account-posting');
    assert.equal(txn.postings[1].accountToken.text, 'Expenses:Food');

    // An unclosed brace still synchronizes at the next top-level directive.
    const unclosed = [
      '2026-06-01 * "Unclosed brace"',
      '  choose account {',
      '    when ???: Assets:Cash',
      '2026-06-02 open Assets:Bank',
      '',
    ].join('\n');
    const unclosedTree = parseSyntaxResilient(unclosed);
    assert.equal(unclosedTree.directives.length, 2);
    assert.equal(unclosedTree.directives[0].type, 'transaction');
    assert.equal(unclosedTree.directives[0].postings.length, 1);
    assert.equal(unclosedTree.directives[0].postings[0].type, 'error');
    assert.equal(unclosedTree.directives[1].type, 'open');
  });

  await test('does not split transactions on metadata keys named option, load, or account-rule during recovery', () => {
    const src = [
      '2026-06-01 * "Broken posting before keyword metadata"',
      '  Expenses:Food  10 ???',
      '    option: "foo"',
      '    load: "bar"',
      '    account-rule: "baz"',
      '  Assets:Cash  -10 CHF',
      'option ?bad',
      '2026-06-02 open Assets:Bank',
      '',
    ].join('\n');

    const tree = parseSyntaxResilient(src);
    assert.equal(tree.directives.length, 3);
    const txn = tree.directives[0];
    assert.equal(txn.type, 'transaction');
    assert.equal(txn.postings.length, 3);
    assert.equal(txn.postings[0].type, 'account-posting');
    assert.equal(txn.postings[1].type, 'error');
    assert.equal(txn.postings[2].type, 'account-posting');
    assert.equal(txn.postings[2].accountToken.text, 'Assets:Cash');

    assert.equal(tree.directives[1].type, 'error');
    assert.equal(tree.directives[2].type, 'open');
  });

  await test('does not split broken choose account blocks on condition literals named option, load, or account-rule', () => {
    const src = [
      '2026-06-01 * "Broken inline condition with keyword literal"',
      '  choose account {',
      '    when ??? and tag == option and a == 1: Assets:Cash',
      '  }',
      '  Expenses:Food  10 USD',
      '',
    ].join('\n');

    const tree = parseSyntaxResilient(src);
    assert.equal(tree.directives.length, 1);
    const txn = tree.directives[0];
    assert.equal(txn.type, 'transaction');
    assert.equal(txn.postings.length, 2);
    assert.equal(txn.postings[0].type, 'error');
    assert.equal(txn.postings[1].type, 'account-posting');
    assert.equal(txn.postings[1].accountToken.text, 'Expenses:Food');

    // An unclosed brace still synchronizes on a top-level undated directive.
    const unclosed = [
      '2026-06-01 * "Unclosed brace before option directive"',
      '  choose account {',
      '    when ???: Assets:Cash',
      'option "timezone" "UTC"',
      '',
    ].join('\n');
    const unclosedTree = parseSyntaxResilient(unclosed);
    assert.equal(unclosedTree.directives.length, 2);
    assert.equal(unclosedTree.directives[0].type, 'transaction');
    assert.equal(unclosedTree.directives[0].postings.length, 1);
    assert.equal(unclosedTree.directives[0].postings[0].type, 'error');
    assert.equal(unclosedTree.directives[1].type, 'option');
  });

  await test('does not truncate lexical error snippets mid-escape sequence', () => {
    // Prefix is 42 chars; 36 clean chars + 4-char "\x1b" = 82 > 80, so "\x1b" is omitted cleanly.
    const src = `option ?${'a'.repeat(35)}\x1b[31m\n`;
    const res = parseSyntax(src);
    assert(E.isLeft(res));
    assert(res.left.message.length <= 80);
    assert(!res.left.message.includes('\x1b'));
    assert(!res.left.message.endsWith('\\x'));
    assert(!res.left.message.endsWith('\\x1'));
  });

  await test('reports earlier syntax errors ahead of later lexical errors', () => {
    const src = '2026-01-01 unknown-directive\noption ?bad\n';
    const res = parseSyntax(src);
    assert(E.isLeft(res));
    assert.equal(res.left.srcPos?.row, 1);
    assert.equal(res.left.srcPos?.col, 12);
    assert.match(
      res.left.message,
      /Unable to consume token: unknown-directive/,
    );
  });

  await test('does not allow unclosed strings to span lone CR line breaks', () => {
    const src = '2026-06-01 * "unclosed\r2026-06-02 * "hello"\n';
    const res = parseSyntax(src);
    assert(E.isLeft(res));
    assert.equal(res.left.srcPos?.row, 1);
  });

  await test('stops unknown tokens at structural delimiters during resilient recovery', () => {
    const src = [
      '2026-06-01 * "Broken inline rule"',
      '  choose account {',
      '    when a == ?}',
      '  Expenses:Food  10 USD',
      '  Assets:Cash  -10 USD',
      '',
    ].join('\n');

    const tree = parseSyntaxResilient(src);
    assert.equal(tree.directives.length, 1);
    const txn = tree.directives[0];
    assert.equal(txn.type, 'transaction');
    assert.equal(txn.postings.length, 3);
    assert.equal(txn.postings[0].type, 'error');
    assert.equal(txn.postings[1].type, 'account-posting');
    assert.equal(txn.postings[1].accountToken.text, 'Expenses:Food');
    assert.equal(txn.postings[2].type, 'account-posting');
    assert.equal(txn.postings[2].accountToken.text, 'Assets:Cash');
  });

  await test('does not absorb malformed column-1 dated directives into preceding transactions or balances', () => {
    const txnSrc = [
      '2026-06-01 * "Valid txn"',
      '  Assets:Bank  10 CHF',
      '  Expenses:Food  -10 CHF',
      '',
      '2026-06-02 unknown-directive Assets:Cash',
      '2026-06-03 open Assets:Savings',
      '',
    ].join('\n');

    const txnTree = parseSyntaxResilient(txnSrc);
    assert.equal(txnTree.directives.length, 3);
    assert.equal(txnTree.directives[0].type, 'transaction');
    assert.equal(txnTree.directives[0].postings.length, 2);
    assert.equal(txnTree.directives[1].type, 'error');
    assert.equal(txnTree.directives[2].type, 'open');

    const balSrc = [
      '2026-06-01 balance',
      '  Assets:Bank  10 CHF',
      '',
      '2026-06-02 unknown-dir Assets:Cash 5 USD',
      '2026-06-03 open Assets:Savings',
      '',
    ].join('\n');

    const balTree = parseSyntaxResilient(balSrc);
    assert.equal(balTree.directives.length, 3);
    assert.equal(balTree.directives[0].type, 'balance');
    assert.equal(balTree.directives[0].balances.length, 1);
    assert.equal(balTree.directives[1].type, 'error');
    assert.equal(balTree.directives[2].type, 'open');
  });

  await test('does not split transactions on date metadata before flagged postings or keyword metadata', () => {
    const flaggedSrc = [
      '2026-06-01 * "Broken posting before date+flagged"',
      '  Expenses:Food  10 ???',
      '    settled: 2026-06-02',
      '  * Assets:Cash  -10 CHF',
      '  Assets:Bank  0 CHF',
      '',
    ].join('\n');

    const flaggedTree = parseSyntaxResilient(flaggedSrc);
    assert.equal(flaggedTree.directives.length, 1);
    const flaggedTxn = flaggedTree.directives[0];
    assert.equal(flaggedTxn.type, 'transaction');
    assert.equal(flaggedTxn.postings.length, 4);
    assert.equal(flaggedTxn.postings[0].type, 'account-posting');
    assert.equal(flaggedTxn.postings[1].type, 'error');
    assert.equal(flaggedTxn.postings[2].type, 'account-posting');
    assert.equal(flaggedTxn.postings[2].accountToken.text, 'Assets:Cash');
    assert.equal(flaggedTxn.postings[3].type, 'account-posting');
    assert.equal(flaggedTxn.postings[3].accountToken.text, 'Assets:Bank');

    const metaSrc = [
      '2026-06-01 * "Broken posting before date+open meta"',
      '  Expenses:Food  10 ???',
      '    settled: 2026-06-02',
      '    open: "yes"',
      '  Assets:Cash  -10 CHF',
      '',
    ].join('\n');

    const metaTree = parseSyntaxResilient(metaSrc);
    assert.equal(metaTree.directives.length, 1);
    const metaTxn = metaTree.directives[0];
    assert.equal(metaTxn.type, 'transaction');
    assert.equal(metaTxn.postings.length, 3);
    assert.equal(metaTxn.postings[0].type, 'account-posting');
    assert.equal(metaTxn.postings[1].type, 'error');
    assert.equal(metaTxn.postings[2].type, 'account-posting');
    assert.equal(metaTxn.postings[2].accountToken.text, 'Assets:Cash');
  });

  await test('sanitizes control sequences in resilient ErrorCst messages', () => {
    const tree = parseSyntaxResilient('option \x1b[31mred\x1b[0m\n');
    assert.equal(tree.directives.length, 1);
    assert.equal(tree.directives[0].type, 'error');
    assert(!tree.directives[0].message.includes('\x1b'));
    assert(tree.directives[0].message.includes('\\x1b[31mred'));
  });

  await test('preserves long syntax error tokens up to 200 chars and truncates oversized messages with ellipsis', () => {
    const mediumIdent = `unknown-${'a'.repeat(80)}`;
    const mediumRes = parseSyntax(`2026-01-01 ${mediumIdent}\n`);
    assert(E.isLeft(mediumRes));
    assert(mediumRes.left.message.includes(mediumIdent));

    const hugeIdent = `unknown-${'b'.repeat(250)}`;
    const hugeRes = parseSyntax(`2026-01-01 ${hugeIdent}\n`);
    assert(E.isLeft(hugeRes));
    assert.equal(hugeRes.left.message.length, 200);
    assert(hugeRes.left.message.endsWith('...'));
  });
});
