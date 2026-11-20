import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import {
  breakParent,
  concat,
  fill,
  group,
  hardline,
  ifBreak,
  indent,
  line,
  lineSuffix,
  printDoc,
  softline,
  text,
} from './doc.js';

await describe('doc layout engine', async () => {
  await test('propagates unconditional breaks across nested groups', () => {
    const doc = group(
      concat([
        text('{'),
        indent(
          2,
          concat([
            line,
            group(
              concat([
                text('10'),
                line,
                text('; comment'),
                hardline,
                text('USD'),
              ]),
            ),
            text(','),
            line,
            text('"tag"'),
          ]),
        ),
        line,
        text('}'),
      ]),
    );

    assert.equal(
      printDoc(doc, 80),
      ['{', '  10', '  ; comment', '  USD,', '  "tag"', '}'].join('\n'),
    );
  });

  await test('propagates breakParent and shouldBreak from inner groups to outer ifBreak', () => {
    const doc = group(
      concat([
        text('['),
        indent(
          2,
          concat([
            softline,
            group(concat([text('a'), breakParent, line, text('b')])),
            ifBreak(text(',')),
          ]),
        ),
        softline,
        text(']'),
      ]),
    );

    assert.equal(printDoc(doc, 80), ['[', '  a', '  b,', ']'].join('\n'));
  });

  await test('breaks enclosing groups on lineSuffix and flushes suffixes before newlines', () => {
    const midGroup = group(
      concat([text('a'), lineSuffix('  ; mid'), line, text('b')]),
    );
    assert.equal(printDoc(midGroup, 80), 'a  ; mid\nb');

    // Breaking the outer line flushes the suffix and keeps a following sibling
    // group flat when it fits on its own line.
    const outerLineBeforeNested = group(
      concat([
        text('a'),
        lineSuffix('  ; c1'),
        line,
        group(concat([text('b'), line, text('c')])),
      ]),
    );
    assert.equal(printDoc(outerLineBeforeNested, 80), 'a  ; c1\nb c');
  });

  await test('respects initialColumn when deciding whether a group fits printWidth', () => {
    const doc = indent(
      2,
      group(
        concat([
          text('{'),
          indent(2, concat([line, text('185.50 USD,'), line, text('"lot-1"')])),
          line,
          text('}'),
        ]),
      ),
    );

    assert.equal(printDoc(doc, 40, 0), '{ 185.50 USD, "lot-1" }');
    assert.equal(
      printDoc(doc, 40, 30),
      ['{', '    185.50 USD,', '    "lot-1"', '  }'].join('\n'),
    );
  });

  await test('packs fill items per line up to printWidth and breaks on comments', () => {
    const doc = group(
      concat([
        text('{'),
        indent(
          2,
          concat([
            line,
            fill([
              text('A,'),
              line,
              concat([text('B,'), lineSuffix('  ; comment')]),
              line,
              text('C,'),
              line,
              text('D'),
            ]),
          ]),
        ),
        line,
        text('}'),
      ]),
    );

    assert.equal(
      printDoc(doc, 40),
      ['{', '  A, B,  ; comment', '  C, D', '}'].join('\n'),
    );

    const widthDoc = group(
      concat([
        text('{'),
        indent(
          2,
          concat([
            line,
            fill([
              text('100.00 USD,'),
              line,
              text('2026-05-01,'),
              line,
              text('"lot-label"'),
            ]),
          ]),
        ),
        line,
        text('}'),
      ]),
    );

    // Fits on single line at initialColumn = 0.
    assert.equal(
      printDoc(widthDoc, 60, 0),
      '{ 100.00 USD, 2026-05-01, "lot-label" }',
    );
    // Overflows at initialColumn = 35, so wraps braces and keeps all items on one indented line.
    assert.equal(
      printDoc(widthDoc, 60, 35),
      ['{', '  100.00 USD, 2026-05-01, "lot-label"', '}'].join('\n'),
    );
    // Narrow width packs 2 items on the first line and 1 on the second.
    assert.equal(
      printDoc(widthDoc, 30, 0),
      ['{', '  100.00 USD, 2026-05-01,', '  "lot-label"', '}'].join('\n'),
    );
  });

  await test('accounts for trailing stack content in fill and strips trailing whitespace at EOF', () => {
    const fillWithTail = concat([
      fill([text('aaaa'), line, text('bbbb')]),
      text('CCCCCCCCCC'),
    ]);
    assert.equal(printDoc(fillWithTail, 10), 'aaaa\nbbbbCCCCCCCCCC');

    const lastGroupInFill = concat([
      fill([text('aaaa'), line, group(concat([text('b'), line, text('c')]))]),
      text('DDDDDDDDDD'),
    ]);
    assert.equal(printDoc(lastGroupInFill, 10), 'aaaa\nb\ncDDDDDDDDDD');

    // Trailing horizontal whitespace is stripped before flushed lineSuffixes
    // and on the final line (EOF).
    const flatLineBeforeEofSuffix = concat([
      text('a'),
      lineSuffix('  ; end'),
      group(line),
    ]);
    assert.equal(printDoc(flatLineBeforeEofSuffix, 80), 'a  ; end');

    const trailingIndentAtEof = concat([text('a'), indent(4, hardline)]);
    assert.equal(printDoc(trailingIndentAtEof, 80), 'a\n');
  });
});
