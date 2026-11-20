import { TokenPosition } from 'typescript-parsec';

import { SourcePoint, SourceSpan } from '../source-span.js';
import { RichToken, TokenKind } from '../token.js';
import { CommentTrivia, TriviaItem } from '../trivia.js';

type LexRule = readonly [RegExp, TokenKind];

interface RuleEntry {
  readonly leadChars: string;
  readonly rule: LexRule;
}

const RULE_ENTRIES: readonly RuleEntry[] = [
  {
    leadChars: '-0123456789',
    rule: [/[-]?\d+(?:,\d{3})*(?:[.]\d*)?/y, TokenKind.NumberLiteral],
  },
  {
    leadChars: '0123456789',
    rule: [/\d{4}-\d{2}-\d{2}/y, TokenKind.DateLiteral],
  },
  {
    leadChars: '0123456789',
    rule: [/\d{2}:\d{2}(?::\d{2})?/y, TokenKind.TimeLiteral],
  },
  {
    leadChars: '+-Z',
    rule: [/(?:[+-]\d{2}:\d{2}|Z\b)/y, TokenKind.TimeZoneLiteral],
  },
  {
    leadChars: '"',
    rule: [/"[^"\n]*"/y, TokenKind.StringLiteral],
  },
  {
    leadChars: 'abcdefghijklmnopqrstuvwxyz',
    rule: [/[a-z][a-z0-9_-]*/y, TokenKind.Identifier],
  },
  {
    leadChars: 'AEILT',
    rule: [
      /(?:Assets|Liabilities|Income|Expenses|Equity|Trading)(?::[A-Z0-9][\w-]+)+/y,
      TokenKind.Account,
    ],
  },
  {
    leadChars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    rule: [/[A-Z][A-Z0-9._-]+/y, TokenKind.Currency],
  },

  { leadChars: '+', rule: [/[+]/y, TokenKind.Plus] },
  { leadChars: '-', rule: [/[-]/y, TokenKind.Minus] },
  { leadChars: '*', rule: [/[*]/y, TokenKind.Times] },
  { leadChars: '/', rule: [/[/]/y, TokenKind.Divide] },
  { leadChars: '=', rule: [/==/y, TokenKind.Equal] },
  { leadChars: '!', rule: [/!=/y, TokenKind.NotEqual] },
  { leadChars: '<', rule: [/<=/y, TokenKind.LessThanOrEqual] },
  { leadChars: '<', rule: [/</y, TokenKind.LessThan] },
  { leadChars: '>', rule: [/>=/y, TokenKind.GreaterThanOrEqual] },
  { leadChars: '>', rule: [/>/y, TokenKind.GreaterThan] },

  { leadChars: '(', rule: [/[(]/y, TokenKind.OpenParen] },
  { leadChars: ')', rule: [/[)]/y, TokenKind.CloseParen] },
  { leadChars: '{', rule: [/{/y, TokenKind.OpenBrace] },
  { leadChars: '}', rule: [/}/y, TokenKind.CloseBrace] },
  { leadChars: '{', rule: [/{{/y, TokenKind.DoubleOpenBrace] },
  { leadChars: '}', rule: [/}}/y, TokenKind.DoubleCloseBrace] },
  { leadChars: '@', rule: [/@/y, TokenKind.At] },
  { leadChars: '@', rule: [/@@/y, TokenKind.DoubleAt] },
  { leadChars: ',', rule: [/,/y, TokenKind.Comma] },
  { leadChars: ':', rule: [/:/y, TokenKind.Colon] },
  { leadChars: '!', rule: [/!/y, TokenKind.ExclamationMark] },
  { leadChars: '~', rule: [/~/y, TokenKind.Tilde] },
];

const EMPTY_RULES: readonly LexRule[] = [];

// Precompute a 128-entry ASCII dispatch table preserving RULE_ENTRIES order.
const ASCII_RULES: readonly (readonly LexRule[])[] = Array.from(
  { length: 128 },
  (_, code) => {
    const ch = String.fromCharCode(code);
    const matching = RULE_ENTRIES.filter(entry =>
      entry.leadChars.includes(ch),
    ).map(entry => entry.rule);
    return matching.length > 0 ? matching : EMPTY_RULES;
  },
);

const SPACE_RULE = /\s+/y;
const UNKNOWN_RULE = /[^\s;]+/y;

export interface TokenizeResult {
  readonly firstToken: RichToken | undefined;
  readonly eofTrivia: readonly TriviaItem[];
  readonly firstUnknownToken: RichToken | undefined;
}

interface MutableRichToken {
  readonly kind: TokenKind;
  readonly text: string;
  readonly pos: TokenPosition;
  readonly span: SourceSpan;
  readonly leadingTrivia: readonly TriviaItem[];
  trailingComment: CommentTrivia | null;
  readonly hasLeadingNewline: boolean;
  prev: RichToken | undefined;
  next: RichToken | undefined;
}

const NO_TRIVIA: readonly TriviaItem[] = [];

function advanceTokenCoordinates(
  contents: string,
  startOffset: number,
  endOffset: number,
  rowBegin: number,
  colBegin: number,
): { readonly pos: TokenPosition; readonly span: SourceSpan } {
  let rowEnd = rowBegin;
  let colEnd = colBegin;
  for (let i = startOffset; i < endOffset; i++) {
    const ch = contents.charCodeAt(i);
    // Match typescript-parsec's LexerImpl coordinate tracking: on CRLF (\r\n)
    // inputs, ignore '\r' for 1-based column numbering while still counting its
    // UTF-16 code unit in endOffset below.
    if (ch === 13) {
      continue;
    }
    if (ch === 10) {
      rowEnd++;
      colEnd = 1;
    } else {
      colEnd++;
    }
  }
  const start: SourcePoint = {
    offset: startOffset,
    row: rowBegin,
    col: colBegin,
  };
  const end: SourcePoint = {
    offset: endOffset,
    row: rowEnd,
    col: colEnd,
  };
  return {
    pos: {
      index: startOffset,
      rowBegin,
      columnBegin: colBegin,
      rowEnd,
      columnEnd: colEnd,
    },
    span: { start, end },
  };
}

/**
 * Tokenizes source text into a doubly-linked `RichToken` stream with trivia.
 *
 * Token `.next` pointers skip whitespace and comments for `typescript-parsec`
 * compatibility while preserving leading/trailing comments and blank-line
 * counts on adjacent tokens.
 *
 * @param contents Raw Ledger source text to tokenize.
 * @returns The first token, trailing EOF trivia, and first unknown token if
 *   any.
 */
export function tokenizeWithTrivia(contents: string): TokenizeResult {
  const len = contents.length;
  let firstToken: MutableRichToken | undefined;
  let lastToken: MutableRichToken | undefined;
  let firstUnknownToken: RichToken | undefined;

  let index = 0;
  let row = 1;
  let col = 1;

  let atStartOfFile = true;
  let newlines = 0;
  let lastSpaceSpan: SourceSpan | undefined;
  let pendingTrivia: TriviaItem[] | undefined;

  while (index < len) {
    const code = contents.charCodeAt(index);

    // 1. Fast-path ASCII and Unicode whitespace.
    if (
      code === 32 ||
      (code >= 9 && code <= 13) ||
      (code >= 128 &&
        ((SPACE_RULE.lastIndex = index), SPACE_RULE.test(contents)))
    ) {
      const startOffset = index;
      const rowBegin = row;
      const colBegin = col;

      if (code < 128) {
        while (index < len) {
          const c = contents.charCodeAt(index);
          if (c === 32 || c === 9 || c === 11 || c === 12) {
            col++;
            index++;
          } else if (c === 13) {
            index++;
          } else if (c === 10) {
            newlines++;
            row++;
            col = 1;
            index++;
          } else if (c >= 128) {
            SPACE_RULE.lastIndex = index;
            if (!SPACE_RULE.test(contents)) {
              break;
            }
            const wsEnd = SPACE_RULE.lastIndex;
            while (index < wsEnd) {
              const uc = contents.charCodeAt(index);
              if (uc === 10) {
                newlines++;
                row++;
                col = 1;
              } else if (uc !== 13) {
                col++;
              }
              index++;
            }
          } else {
            break;
          }
        }
      } else {
        const wsEnd = SPACE_RULE.lastIndex;
        while (index < wsEnd) {
          const uc = contents.charCodeAt(index);
          if (uc === 10) {
            newlines++;
            row++;
            col = 1;
          } else if (uc !== 13) {
            col++;
          }
          index++;
        }
      }

      if (!atStartOfFile && newlines >= 2) {
        lastSpaceSpan = {
          start: { offset: startOffset, row: rowBegin, col: colBegin },
          end: { offset: index, row, col },
        };
      }
      continue;
    }

    // 2. Fast-path ';' comments up to '\r' or '\n'.
    if (code === 59) {
      const startOffset = index;
      const colBegin = col;
      index++;
      while (index < len) {
        const c = contents.charCodeAt(index);
        if (c === 10 || c === 13) {
          break;
        }
        index++;
      }
      const colEnd = colBegin + (index - startOffset);
      const commentItem: CommentTrivia = {
        kind: 'comment',
        text: contents.slice(startOffset, index),
        span: {
          start: { offset: startOffset, row, col: colBegin },
          end: { offset: index, row, col: colEnd },
        },
      };
      col = colEnd;

      if (
        lastToken !== undefined &&
        newlines === 0 &&
        pendingTrivia === undefined
      ) {
        lastToken.trailingComment = commentItem;
      } else {
        pendingTrivia ??= [];
        if (!atStartOfFile && newlines >= 2 && lastSpaceSpan !== undefined) {
          pendingTrivia.push({
            kind: 'blank-lines',
            count: newlines - 1,
            span: lastSpaceSpan,
          });
        }
        pendingTrivia.push(commentItem);
        atStartOfFile = false;
        newlines = 0;
        lastSpaceSpan = undefined;
      }
      continue;
    }

    // 3. Match real token using first-character dispatch table.
    const rules = code < 128 ? ASCII_RULES[code] : EMPTY_RULES;
    let bestKind: TokenKind | undefined;
    let bestLength = 0;

    for (let i = 0; i < rules.length; i++) {
      const [regex, kind] = rules[i];
      regex.lastIndex = index;
      if (regex.test(contents)) {
        const matchLen = regex.lastIndex - index;
        if (matchLen > bestLength) {
          bestLength = matchLen;
          bestKind = kind;
        }
      }
    }

    if (bestKind === undefined) {
      UNKNOWN_RULE.lastIndex = index;
      const matched = UNKNOWN_RULE.test(contents);
      bestLength = matched ? UNKNOWN_RULE.lastIndex - index : 1;
      bestKind = TokenKind.Unknown;
    }

    const endOffset = index + bestLength;
    const text = contents.slice(index, endOffset);
    const { pos, span } = advanceTokenCoordinates(
      contents,
      index,
      endOffset,
      row,
      col,
    );

    const hasLeadingNewline =
      !atStartOfFile && (newlines >= 1 || pendingTrivia !== undefined);
    if (!atStartOfFile && newlines >= 2 && lastSpaceSpan !== undefined) {
      pendingTrivia ??= [];
      pendingTrivia.push({
        kind: 'blank-lines',
        count: newlines - 1,
        span: lastSpaceSpan,
      });
    }

    const token: MutableRichToken = {
      kind: bestKind,
      text,
      pos,
      span,
      leadingTrivia: pendingTrivia ?? NO_TRIVIA,
      trailingComment: null,
      hasLeadingNewline,
      prev: lastToken as RichToken | undefined,
      next: undefined,
    };

    if (lastToken !== undefined) {
      lastToken.next = token as RichToken;
    } else {
      firstToken = token;
    }
    lastToken = token;

    if (bestKind === TokenKind.Unknown && firstUnknownToken === undefined) {
      firstUnknownToken = token as RichToken;
    }

    pendingTrivia = undefined;
    newlines = 0;
    lastSpaceSpan = undefined;
    atStartOfFile = false;
    index = endOffset;
    row = span.end.row;
    col = span.end.col;
  }

  return {
    firstToken: firstToken as RichToken | undefined,
    eofTrivia: pendingTrivia ?? NO_TRIVIA,
    firstUnknownToken,
  };
}
