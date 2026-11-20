import { RichToken } from '../../syntax/token.js';
import { TriviaItem } from '../../syntax/trivia.js';
import { normalizeCommentText } from './comment.js';
import { concat, Doc, emptyDoc, hardline, joinDocs, text } from './doc.js';

export interface ShiftedComments {
  /** Normalized comments hoisted as standalone lines above the construct. */
  readonly hoisted: readonly string[];
  /** Single normalized trailing inline comment for the end of the construct. */
  readonly trailing: string | null;
}

export function indentStr(indentWidth: number, levels = 1): string {
  return ' '.repeat(indentWidth * levels);
}

export function lastLineLength(textValue: string): number {
  const lastNewline = textValue.lastIndexOf('\n');
  return lastNewline === -1
    ? textValue.length
    : textValue.length - lastNewline - 1;
}

export function trailingCommentText(token: RichToken): string | null {
  return token.trailingComment !== null
    ? normalizeCommentText(token.trailingComment.text)
    : null;
}

export function collectLeadingComments(token: RichToken): string[] {
  const out: string[] = [];
  for (const item of token.leadingTrivia) {
    if (item.kind === 'comment') {
      out.push(normalizeCommentText(item.text));
    }
  }
  return out;
}

/**
 * Collects all normalized `;` comments strictly inside `[firstTok .. lastTok]`,
 * excluding `firstTok.leadingTrivia` and `lastTok.trailingComment`.
 */
export function collectInteriorComments(
  firstTok: RichToken,
  lastTok: RichToken,
): string[] {
  const comments: string[] = [];
  for (
    let tok: RichToken | undefined = firstTok;
    tok !== undefined;
    tok = tok.next
  ) {
    if (tok !== firstTok) {
      for (const item of tok.leadingTrivia) {
        if (item.kind === 'comment') {
          comments.push(normalizeCommentText(item.text));
        }
      }
    }
    if (tok === lastTok) {
      break;
    }
    if (tok.trailingComment !== null) {
      comments.push(normalizeCommentText(tok.trailingComment.text));
    }
  }
  return comments;
}

/**
 * Shifts non-canonical interior comments into canonical leading/trailing slots
 * while preserving exact comment ordering and idempotency.
 *
 * - If an external trailing comment already exists, all interior comments hoist
 *   above the construct so the external trailing comment stays at the end.
 * - Otherwise, the final interior comment right-shifts to the trailing slot and
 *   any earlier interior comments hoist above.
 */
export function shiftComments(
  interiorComments: readonly string[],
  externalTrailing: string | null,
): ShiftedComments {
  if (externalTrailing !== null) {
    return { hoisted: interiorComments, trailing: externalTrailing };
  }
  if (interiorComments.length === 0) {
    return { hoisted: [], trailing: null };
  }
  return {
    hoisted: interiorComments.slice(0, -1),
    trailing: interiorComments[interiorComments.length - 1],
  };
}

export function formatClosingLeadingTrivia(items: readonly TriviaItem[]): Doc {
  let end = items.length;
  while (end > 0 && items[end - 1].kind === 'blank-lines') {
    end--;
  }
  if (end === 0) {
    return emptyDoc;
  }
  return concat([
    hardline,
    joinDocs(
      hardline,
      items
        .slice(0, end)
        .map(item =>
          item.kind === 'blank-lines'
            ? emptyDoc
            : text(normalizeCommentText(item.text)),
        ),
    ),
  ]);
}

export function formatLeadingBlockLines(
  trivia: readonly TriviaItem[],
  indentWidth: number,
  indentLevels: number,
  hoistedComments: readonly string[] = [],
): string[] {
  const pad = indentStr(indentWidth, indentLevels);
  const lines: string[] = [];
  for (const item of trivia) {
    if (item.kind === 'blank-lines') {
      lines.push('');
    } else {
      lines.push(`${pad}${normalizeCommentText(item.text)}`);
    }
  }
  for (const comment of hoistedComments) {
    lines.push(`${pad}${comment}`);
  }
  return lines;
}
