/**
 * Normalizes spacing in a single-line `;` comment.
 *
 * Trims trailing whitespace and ensures a single space after a lone leading
 * semicolon (`;note` becomes `; note`), while leaving `;` and `;;` headers
 * intact.
 *
 * @param rawComment Raw `;` comment text.
 * @returns The normalized comment string.
 */
export function normalizeCommentText(rawComment: string): string {
  const trimmed = rawComment.trimEnd();
  if (trimmed.length <= 1) {
    return ';';
  }
  const second = trimmed[1];
  if (second === ' ' || second === '\t' || second === ';') {
    return trimmed;
  }
  return `; ${trimmed.slice(1)}`;
}
