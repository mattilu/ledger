import { TriviaItem } from '../../syntax/trivia.js';

const FORMAT_OFF_REGEX = /^;\s*ledger-fmt:\s*off\s*$/;
const FORMAT_ON_REGEX = /^;\s*ledger-fmt:\s*on\s*$/;

/**
 * Checks whether `item` is a `; ledger-fmt: off` pragma comment.
 *
 * @param item Trivia item to inspect.
 * @returns `true` if `item` disables formatting, otherwise `false`.
 */
export function isFormatOffTrivia(item: TriviaItem): boolean {
  return item.kind === 'comment' && FORMAT_OFF_REGEX.test(item.text);
}

/**
 * Checks whether `item` is a `; ledger-fmt: on` pragma comment.
 *
 * @param item Trivia item to inspect.
 * @returns `true` if `item` re-enables formatting, otherwise `false`.
 */
export function isFormatOnTrivia(item: TriviaItem): boolean {
  return item.kind === 'comment' && FORMAT_ON_REGEX.test(item.text);
}
