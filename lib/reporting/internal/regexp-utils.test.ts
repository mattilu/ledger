import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { makeRegexp } from './regexp-utils.js';

await describe('makeRegexp', async () => {
  await it('returns null if values is empty', () => {
    const got = makeRegexp([]);
    assert.equal(got, null);
  });

  await it('returns a regex that matches a plain string, full match', () => {
    const got = makeRegexp(['Foo']);
    assert(got !== null);

    assert(got.test('Foo'));
    assert(!got.test('BarFoo'));
    assert(!got.test('FooBar'));
  });

  await it('returns a regex that matches multiple strings, full match', () => {
    const got = makeRegexp(['Foo', 'Bar', 'Baz']);
    assert(got !== null);

    assert(got.test('Foo'));
    assert(got.test('Bar'));
    assert(got.test('Baz'));
    assert(!got.test('FooBar'));
    assert(!got.test('BarBaz'));
  });

  await it('returns a regex that matches multiple regexes, full match', () => {
    const got = makeRegexp(['Foo|Bar', 'Qu+x']);
    assert(got !== null);

    assert(got.test('Foo'));
    assert(got.test('Bar'));
    assert(got.test('Quuuux'));
    assert(!got.test('FooBar'));
    assert(!got.test('BarBaz'));
  });

  await it('returns a regex that matches multiple regexes, partial match', () => {
    const got = makeRegexp(['.*(Foo|Bar).*', '.*Qu+x.*']);
    assert(got !== null);

    assert(got.test('Foo'));
    assert(got.test('Bar'));
    assert(got.test('A Quuuux!'));
    assert(got.test('Foo and Bar'));
  });
});
