/* deletion-logs.ts
 *
 * Data model for audit logging deleted Firestore documents with their full
 * pre-deletion data snapshots, deletion timestamp, and actor identity.
 */

import { FsTimestamp } from './base';

export enum DeletionSource {
  CloudFunctionTrigger = 'cloud_function_trigger',
  ClientAction = 'client_action',
  AdminScript = 'admin_script',
}

export interface DeletionLogActor {
  email: string;
  name?: string;
  uid?: string;
}

export interface DeletionLogEntry<T = Record<string, unknown>> {
  /** Generated unique document ID for this log entry */
  id?: string;
  /** Name of the collection the document was deleted from (e.g. 'members', 'schools') */
  collectionName: string;
  /** Document ID of the deleted entity */
  docId: string;
  /** Firestore Timestamp when the deletion occurred / was recorded */
  deletedAt: FsTimestamp;
  /** Email or username of the actor who performed or triggered the deletion */
  deletedBy: string;
  /** Full display name of the actor */
  deletedByName?: string;
  /** Firebase Auth UID of the actor if authenticated */
  deletedByUid?: string;
  /** How the deletion was triggered */
  source: DeletionSource;
  /** Complete pre-deletion snapshot of the document */
  data: T;
}
