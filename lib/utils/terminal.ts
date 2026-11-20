function escapeUnsafeChar(ch: string, escapeNewlines: boolean): string | null {
  const code = ch.charCodeAt(0);
  if (
    (code <= 0x1f && code !== 0x09 && (escapeNewlines || code !== 0x0a)) ||
    (code >= 0x7f && code <= 0x9f)
  ) {
    return `\\x${code.toString(16).padStart(2, '0')}`;
  }
  if (
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  ) {
    return `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return null;
}

/**
 * Escapes unsafe terminal control characters (`C0`/`C1` except `\t` and, by
 * default, `\n`) as `\xNN` and Unicode Bidi / line-separator controls as
 * `\uXXXX` so untrusted text cannot inject ANSI escapes or spoof terminal text.
 *
 * When `maxLength` is provided, stops before emitting any character, surrogate
 * pair, or escape sequence that would cause the output length to exceed
 * `maxLength`.
 *
 * @param text Raw string to sanitize.
 * @param maxLength Optional maximum UTF-16 length of the returned string.
 * @param escapeNewlines When `true`, also escapes `\n` as `\x0a` (useful for
 *   single-line diagnostics such as file paths).
 * @returns The sanitized string.
 */
export function sanitizeTerminalText(
  text: string,
  maxLength?: number,
  escapeNewlines = false,
): string {
  if (maxLength !== undefined && !(maxLength > 0)) {
    return '';
  }
  const limit = maxLength ?? Number.POSITIVE_INFINITY;

  const parts: string[] = [];
  let len = 0;
  for (const ch of text) {
    const piece = escapeUnsafeChar(ch, escapeNewlines) ?? ch;
    if (len + piece.length > limit) {
      break;
    }
    parts.push(piece);
    len += piece.length;
  }
  return parts.join('');
}
