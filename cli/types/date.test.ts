import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { date } from './date.js';

await describe('date', async () => {
  await describe('#from', async () => {
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
      await it(`parses a valid date [${t.name}]`, async () => {
        const got = await date.from(t.input);
        assert.deepEqual(got, t.want);
      });
    }
  });
});
