import {
  Timestamp,
  FieldValue,
} from 'firebase/firestore';
import type { FieldValue as AdminFieldValue } from 'firebase-admin/firestore';

export type FsTimestamp = Timestamp | FieldValue | AdminFieldValue;

export type GenericFsDoc = { data: () => unknown; id: string };

/**
 * Normalizes any timestamp representation (Firestore Timestamp, Date, or string)
 * into a standard, lexicographically-sortable ISO 8601 string (UTC).
 */
export function normalizeLastUpdated(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  try {
    return new Date(val as string).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

export { FirestoreCollection, FirestoreSubcollection } from './collections';
