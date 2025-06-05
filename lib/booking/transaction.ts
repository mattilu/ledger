import { Amount } from '../core/amount.js';
import { Metadata } from '../loading/metadata.js';
import { SourceContext } from '../loading/source-context.js';
import { Cost } from './cost.js';
import { InventoryMap } from './inventory.js';

export interface BookedPosting {
  readonly account: string;
  readonly flag: string;
  readonly amount: Amount;
  readonly cost: Cost | null;
  readonly meta: Metadata;
}

export interface Transaction {
  readonly date: Date;
  readonly description: string;
  readonly flag: string;
  readonly meta: Metadata;
  readonly postings: BookedPosting[];
  readonly inventoriesBefore: InventoryMap;
  readonly inventoriesAfter: InventoryMap;
  readonly srcCtx: SourceContext;
}
