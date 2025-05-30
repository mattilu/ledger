export function makeRegexp(values: readonly string[]): RegExp | null {
  if (values.length === 0) {
    return null;
  }
  return new RegExp(`^(?:${values.join('|')})$`, 'i');
}
