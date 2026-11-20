import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { sanitizeTerminalText } from './terminal.js';

await describe('sanitizeTerminalText', async () => {
  await test('leaves safe text, tabs, and newlines unchanged', () => {
    const safe = 'Hello,\tworld!\nLine 2 (CHF 1,234.50)';
    assert.equal(sanitizeTerminalText(safe), safe);
  });

  await test('escapes ANSI and C0/C1 control characters', () => {
    assert.equal(
      sanitizeTerminalText('\x1b[31mred\x1b[0m\x00\x07\x7f\x9b'),
      '\\x1b[31mred\\x1b[0m\\x00\\x07\\x7f\\x9b',
    );
  });

  await test('respects maxLength without splitting escape sequences', () => {
    assert.equal(sanitizeTerminalText('abcdef', 4), 'abcd');
    assert.equal(sanitizeTerminalText('abcdef', 0), '');
    assert.equal(sanitizeTerminalText('ab\x1bcd', 6), 'ab\\x1b');
    // Only 3 chars left after "ab", not enough for 4-char "\x1b" escape.
    assert.equal(sanitizeTerminalText('ab\x1bcd', 5), 'ab');
    assert.equal(sanitizeTerminalText('ab\x1bcd', 3), 'ab');
    assert.equal(sanitizeTerminalText('ab\x1bcd', 1), 'a');
    assert.equal(sanitizeTerminalText('abcdef', Number.NaN), '');
    assert.equal(sanitizeTerminalText('ab\x1bcd', Number.NaN), '');
  });

  await test('escapes Unicode Bidi controls, line separators, and optional newlines', () => {
    assert.equal(
      sanitizeTerminalText('safe\u202eevil\u2066\u2028\u2029'),
      'safe\\u202eevil\\u2066\\u2028\\u2029',
    );
    assert.equal(sanitizeTerminalText('ab\u202ecd', 8), 'ab\\u202e');
    assert.equal(sanitizeTerminalText('ab\u202ecd', 7), 'ab');
    assert.equal(sanitizeTerminalText('a\nb', undefined, true), 'a\\x0ab');
  });

  await test('does not split UTF-16 surrogate pairs when truncating', () => {
    assert.equal(sanitizeTerminalText('a💰b', 2), 'a');
    assert.equal(sanitizeTerminalText('a💰b', 3), 'a💰');
    assert.equal(sanitizeTerminalText('a💰\x1b', 4), 'a💰');
  });
});
