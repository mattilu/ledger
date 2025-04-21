import { Type } from 'cmd-ts';

const DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|(?:[+-]\d{2}:\d{2}))?)?$/;

// Type for cmd-ts parsing of date flags.
export const date: Type<string, Date> = {
  async from(input: string) {
    if (!DATE_REGEX.test(input)) {
      throw new Error(`invalid date: ${input}`);
    }
    const date = new Date(input);
    if (isNaN(date.getTime())) {
      throw new Error(`invalid date: ${input}`);
    }
    return date;
  },
  displayName: 'YYYY-MM-DD[THH:mm[:ss][Z]]',
};
