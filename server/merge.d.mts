export interface RecordChange {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ChangeSet {
  records: Record<string, Record<string, RecordChange>>;
  workspace?: { before: Record<string, unknown>; after: Record<string, unknown> };
  activity?: { id: string; [key: string]: unknown }[];
  trash?: { add: { id: string; [key: string]: unknown }[]; remove: string[] };
}

export const COLLECTIONS: readonly string[];
export function same(a: unknown, b: unknown): boolean;
export function mergeFields<T extends object>(current: T, before: object, after: object): T;
export function diffShared(base: object | null | undefined, next: object): ChangeSet | null;
export function applyRecord(collection: Record<string, unknown>, id: string, change: RecordChange): void;
export function applyShared<T extends object>(state: T, changes: ChangeSet): T;
