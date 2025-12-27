import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { date } from './date.js';

await describe('date', async () => {
  await describe('#from', async () => {
    await describe('parses a valid date', async () => {
      const tests: Array<{ name: string; input: string; want: Date }> = [
        {
          name: 'date only, uses UTC',
          input: '2025-04-01',
          want: new Date('2025-04-01T00:00:00Z'),
        },
        {
          name: 'date and time, local timezone',
          input: '2025-04-01T01:30',
          want: new Date('2025-04-01T01:30:00'),
        },
        {
          name: 'date and time with seconds, local timezone',
          input: '2025-04-01T01:30:20',
          want: new Date('2025-04-01T01:30:20'),
        },
        {
          name: 'date time and UTC timezone',
          input: '2025-04-01T01:30Z',
          want: new Date('2025-04-01T01:30:00Z'),
        },
        {
          name: 'date time and timezone',
          input: '2025-04-01T02:30+02:00',
          want: new Date('2025-04-01T00:30:00Z'),
        },
      ];

      for (const t of tests) {
        await test(t.name, async () => {
          const got = await date.from(t.input);
          assert.deepEqual(got, t.want);
        });
      }
    });

    await describe('fails on invalid date', async () => {
      await test('invalid format', async () => {
        const got = date.from('not-a-date');
        assert.rejects(got, 'Invalid date');
      });

      await test('invalid date', async () => {
        const got = date.from('2025-12-32');
        assert.rejects(got, 'Invalid date');
      });
    });
  });
});
