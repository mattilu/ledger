import { Amount } from '../core/amount.js';
import { Metadata } from '../loading/metadata.js';
import { SourceContext } from '../loading/source-context.js';
import { Cost } from './cost.js';
import { InventoryMap } from './inventory.js';

export interface BookedPosting {
  /** Account the amount is posted to. */
  readonly account: string;
  /** Flag of the posting. */
  readonly flag: string;
  /** Amount of the posting. */
  readonly amount: Amount;
  /** Cost of the posting, if position is held at cost. */
  readonly cost: Cost | null;
  /** Metadata of the posting. */
  readonly meta: Metadata;
}

export interface Transaction {
  /** Date of the transaction. */
  readonly date: Date;
  /** Description of the transaction. */
  readonly description: string;
  /** Flag of the transaction. */
  readonly flag: string;
  /** List of postings of the transaction. */
  readonly postings: readonly BookedPosting[];
  /** Metadata of the transaction. */
  readonly meta: Metadata;
  /** State of inventories before the transaction. */
  readonly inventoriesBefore: InventoryMap;
  /** State of inventories after the transaction. */
  readonly inventoriesAfter: InventoryMap;
  /** Source context of the transaction. */
  readonly srcCtx: SourceContext;
}
