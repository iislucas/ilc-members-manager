import { TimestampLike } from './timestamp-like';

export const AuditEventType = {
  DocumentModification: 'DOCUMENT_MODIFICATION',
} as const;
export type AuditEventType =
  (typeof AuditEventType)[keyof typeof AuditEventType];

export const AuthContextType = {
  User: 'USER',
  ServiceAccount: 'SERVICE_ACCOUNT',
  System: 'SYSTEM',
  Unauthenticated: 'UNAUTHENTICATED',
  Unknown: 'UNKNOWN',
} as const;
export type AuthContextType =
  (typeof AuthContextType)[keyof typeof AuthContextType];

export type FirestoreAuditAuthContext = {
  authType: AuthContextType;
  /**
   * Firestore trigger authId is optional in the SDK typings.
   * Store null (not undefined) when absent.
   */
  authId: string | null;
};

export const DocumentModificationType = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
} as const;
export type DocumentModificationType =
  (typeof DocumentModificationType)[keyof typeof DocumentModificationType];

export type FirestoreDocumentModification = {
  fieldPath: string;
  type: DocumentModificationType;
  before: string | null;
  after: string | null;
};

export type FirestoreDocumentChangeAuditEvent = {
  // Core audit envelope
  type: AuditEventType;

  // Event metadata (helps with debugging + idempotency)
  eventId: string; // CloudEvent id (use as doc id)
  occurredAt: TimestampLike; // from CloudEvent time if available; else server timestamp at write-time

  // Auth metadata
  authContext: FirestoreAuditAuthContext;

  // Document metadata
  documentPath: string; // e.g. "members/abc123"
  documentId: string; // e.g. "abc123" (from params)
  modificationType: DocumentModificationType;

  // Diff payload
  modifications: FirestoreDocumentModification[];

  // Optional extra metadata (handy in practice)
  project?: string;
  database?: string;
  namespace?: string;
  location?: string;
};
