// onDocumentWrittenWithAuth fires during any write op: set(), set({merge: true}), update(), delete()
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  onDocumentWrittenWithAuthContext,
  Change,
  DocumentSnapshot
} from 'firebase-functions/v2/firestore';
import { AuthType, FirestoreAuthEvent } from 'firebase-functions/firestore';
import { ParamsOf } from 'firebase-functions';
import {
  AuditEventType,
  AuthContextType,
  DocumentModificationType,
  FirestoreDocumentChangeAuditEvent,
  FirestoreDocumentModification
} from '../../shared/src/audit-event-model';

//#pragma region HelperFunctions
// ---------- Helpers ----------
function ensureAdminInitialized() {
  if (getApps().length === 0) {
    initializeApp();
  }
}

function toAuthContextType(t: AuthType): AuthContextType {
  switch (t) {
    case 'api_key':
      return AuthContextType.User;
    case 'service_account':
      return AuthContextType.ServiceAccount;
    case 'system':
      return AuthContextType.System;
    case 'unauthenticated':
      return AuthContextType.Unauthenticated;
    case 'unknown':
    default:
      return AuthContextType.Unknown;
  }
}

function getModificationType(
  beforeSnap: DocumentSnapshot,
  afterSnap: DocumentSnapshot
): DocumentModificationType {
  if (!beforeSnap.exists && afterSnap.exists)
    return DocumentModificationType.CREATE;
  if (beforeSnap.exists && afterSnap.exists)
    return DocumentModificationType.UPDATE;
  if (beforeSnap.exists && !afterSnap.exists)
    return DocumentModificationType.DELETE;
  throw new Error(
    'Either before or after snapshot should exist. Event object likely corrupted.'
  );
}

/**
 * Firestore cannot store `undefined` anywhere.
 * We serialize diffs to strings to keep the audit schema stable across Firestore types.
 */
function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'undefined') return 'undefined';
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);

  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

type PlainObject = Record<string, unknown>;

function snapshotDataOrEmpty(snap: DocumentSnapshot): PlainObject {
  return (snap.data() as PlainObject) ?? {};
}

function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively emit modifications for "leaf" fields using dotted paths.
 * - Plain objects are traversed.
 * - Arrays are atomic leaves (one modification at the array fieldPath).
 * - Non-plain objects are atomic leaves.
 */
function diffLeafFields(params: {
  modificationType: DocumentModificationType;
  beforeData: PlainObject;
  afterData: PlainObject;
  arraysAreAtomic?: boolean;
}): FirestoreDocumentModification[] {
  const {
    modificationType,
    beforeData,
    afterData,
    arraysAreAtomic = true
  } = params;

  const modifications: FirestoreDocumentModification[] = [];

  const joinPath = (base: string, key: string) =>
    base ? `${base}.${key}` : key;

  // Track visited objects to avoid infinite recursion on cycles.
  // Separate sets for before/after traversal is fine; shared also works.
  const seen = new WeakSet<object>();
  const emitCreateLeaves = (basePath: string, afterVal: unknown) => {
    if (isPlainObject(afterVal)) {
      // If we already saw this object, we hit a cycle: treat THIS field as atomic.
      if (seen.has(afterVal as object)) {
        modifications.push({
          fieldPath: basePath,
          type: DocumentModificationType.CREATE,
          before: null,
          after: stringifyValue(afterVal)
        });
        return;
      }

      // Mark this object as seen before descending
      seen.add(afterVal as object);

      // If any child points back to a seen object, treat the whole object as atomic at basePath.
      for (const key of Object.keys(afterVal)) {
        const childVal = (afterVal as PlainObject)[key];

        if (isPlainObject(childVal) && seen.has(childVal as object)) {
          modifications.push({
            fieldPath: basePath,
            type: DocumentModificationType.CREATE,
            before: null,
            after: stringifyValue(afterVal)
          });
          return;
        }
      }

      // Safe to recurse normally
      for (const key of Object.keys(afterVal)) {
        emitCreateLeaves(
          joinPath(basePath, key),
          (afterVal as PlainObject)[key]
        );
      }
      return;
    }

    modifications.push({
      fieldPath: basePath,
      type: DocumentModificationType.CREATE,
      before: null,
      after: stringifyValue(afterVal)
    });
  };

  const emitDeleteLeaves = (basePath: string, beforeVal: unknown) => {
    if (isPlainObject(beforeVal)) {
      if (seen.has(beforeVal as object)) {
        modifications.push({
          fieldPath: basePath,
          type: DocumentModificationType.DELETE,
          before: stringifyValue(beforeVal),
          after: null
        });
        return;
      }

      seen.add(beforeVal as object);

      for (const key of Object.keys(beforeVal)) {
        const childVal = (beforeVal as PlainObject)[key];

        if (isPlainObject(childVal) && seen.has(childVal as object)) {
          modifications.push({
            fieldPath: basePath,
            type: DocumentModificationType.DELETE,
            before: stringifyValue(beforeVal),
            after: null
          });
          return;
        }
      }

      for (const key of Object.keys(beforeVal)) {
        emitDeleteLeaves(
          joinPath(basePath, key),
          (beforeVal as PlainObject)[key]
        );
      }
      return;
    }

    modifications.push({
      fieldPath: basePath,
      type: DocumentModificationType.DELETE,
      before: stringifyValue(beforeVal),
      after: null
    });
  };

  const diffUpdate = (
    basePath: string,
    beforeVal: unknown,
    afterVal: unknown
  ) => {
    if (isPlainObject(beforeVal) && isPlainObject(afterVal)) {
      // If either side cycles, treat as atomic leaf comparison.
      const beforeObj = beforeVal as object;
      const afterObj = afterVal as object;

      const beforeCyc = seen.has(beforeObj);
      const afterCyc = seen.has(afterObj);

      if (beforeCyc || afterCyc) {
        const beforeStr = stringifyValue(beforeVal);
        const afterStr = stringifyValue(afterVal);
        if (beforeStr !== afterStr) {
          modifications.push({
            fieldPath: basePath,
            type: DocumentModificationType.UPDATE,
            before: beforeStr,
            after: afterStr
          });
        }
        return;
      }

      seen.add(beforeObj);
      seen.add(afterObj);

      const beforePlain = beforeVal as PlainObject;
      const afterPlain = afterVal as PlainObject;

      const keys = new Set<string>([
        ...Object.keys(beforePlain),
        ...Object.keys(afterPlain)
      ]);

      for (const key of keys) {
        const childPath = joinPath(basePath, key);

        const beforeHas = Object.prototype.hasOwnProperty.call(
          beforePlain,
          key
        );
        const afterHas = Object.prototype.hasOwnProperty.call(afterPlain, key);

        if (!beforeHas && afterHas) {
          emitCreateLeaves(childPath, afterPlain[key]);
          continue;
        }
        if (beforeHas && !afterHas) {
          emitDeleteLeaves(childPath, beforePlain[key]);
          continue;
        }

        diffUpdate(childPath, beforePlain[key], afterPlain[key]);
      }
      return;
    }

    if (
      arraysAreAtomic &&
      (Array.isArray(beforeVal) || Array.isArray(afterVal))
    ) {
      const beforeStr = stringifyValue(beforeVal);
      const afterStr = stringifyValue(afterVal);
      if (beforeStr !== afterStr) {
        modifications.push({
          fieldPath: basePath,
          type: DocumentModificationType.UPDATE,
          before: beforeStr,
          after: afterStr
        });
      }
      return;
    }

    const beforeStr = stringifyValue(beforeVal);
    const afterStr = stringifyValue(afterVal);
    if (beforeStr !== afterStr) {
      modifications.push({
        fieldPath: basePath,
        type: DocumentModificationType.UPDATE,
        before: beforeStr,
        after: afterStr
      });
    }
  };

  if (modificationType === DocumentModificationType.CREATE) {
    for (const key of Object.keys(afterData))
      emitCreateLeaves(key, afterData[key]);
    return modifications;
  }

  if (modificationType === DocumentModificationType.DELETE) {
    for (const key of Object.keys(beforeData))
      emitDeleteLeaves(key, beforeData[key]);
    return modifications;
  }

  const keys = new Set<string>([
    ...Object.keys(beforeData),
    ...Object.keys(afterData)
  ]);

  for (const key of keys) {
    const beforeHas = Object.prototype.hasOwnProperty.call(beforeData, key);
    const afterHas = Object.prototype.hasOwnProperty.call(afterData, key);

    if (!beforeHas && afterHas) {
      emitCreateLeaves(key, afterData[key]);
      continue;
    }
    if (beforeHas && !afterHas) {
      emitDeleteLeaves(key, beforeData[key]);
      continue;
    }

    diffUpdate(key, beforeData[key], afterData[key]);
  }

  return modifications;
}

export enum FilterMode {
  Whitelist = 0,
  Blacklist = 1,
}

export function applyFilterList<T>(inputs: T[], filterList: T[], mode: FilterMode): T[] {
  // Fast path
  if (!inputs.length) return [];

  // If filter list is empty:
  // - Whitelist => nothing allowed
  // - Blacklist => everything allowed
  if (!filterList.length) return mode === FilterMode.Whitelist ? [] : inputs.slice();

  // Use SameValueZero semantics via Set (treats NaN as equal to NaN)
  const set = new Set<T>(filterList);

  if (mode === FilterMode.Whitelist) {
    return inputs.filter((x) => set.has(x));
  }

  // Blacklist
  return inputs.filter((x) => !set.has(x));
}

//#pragma endregion

//#pragma region DtoConversion
/**
 * Converts a Firestore write event + auth context into a Firestore-friendly audit document.
 */
function firestoreToAuditEvent(params: {
  event: FirestoreAuthEvent<Change<DocumentSnapshot> | undefined>;
  documentId: string;
}): FirestoreDocumentChangeAuditEvent | null {
  const { event, documentId } = params;

  const change = event.data;
  if (!change) {
    return null;
  }

  const beforeSnap = change.before;
  const afterSnap = change.after;

  const modificationType = getModificationType(beforeSnap, afterSnap);

  const beforeData = snapshotDataOrEmpty(beforeSnap);
  const afterData = snapshotDataOrEmpty(afterSnap);

  const modifications = diffLeafFields({
    modificationType,
    beforeData,
    afterData,
    arraysAreAtomic: true
  });

  // Prefer CloudEvent time if present; otherwise use "now".
  // (CloudEvent time is an ISO string.)
  const occurredAt = event.time
    ? Timestamp.fromDate(new Date(event.time))
    : Timestamp.now();

  return {
    type: AuditEventType.DocumentModification,
    eventId: event.id,
    occurredAt,
    authContext: {
      authType: toAuthContextType(event.authType),
      authId: event.authId ?? null
    },
    documentPath: event.document,
    documentId,
    modificationType,
    modifications,
    project: event.project,
    database: event.database,
    namespace: event.namespace,
    location: event.location
  };
}

//#pragma endregion

// ----------------- FUNCTION CONFIG -----------------------
// ---------------------------------------------------------
//#pragma region Config
export type AuditConfig = {
  collectionFilterList: string[];
  collectionFilterMode: FilterMode;
};

// -------------- EDIT CONFIG HERE: ------------------------
const defaultConfig: AuditConfig = {
  collectionFilterList: ['members'],
  collectionFilterMode: FilterMode.Whitelist
};
// ----------------------------------------------------------

// ---- test seam: overridable config provider ----
let _getConfig: () => AuditConfig = () => defaultConfig;

/**
 * TEST-ONLY: allow tests to override config without mutating imports.
 */
export function __setAuditConfigProvider(getter: () => AuditConfig) {
  _getConfig = getter;
}

export function __resetAuditConfigProvider() {
  _getConfig = () => defaultConfig;
}

function getConfig(): AuditConfig {
  return _getConfig();
}

//#pragma endregion

//#pragma region EventHandler
export function createAuditHandler() {
  return async (
    event: FirestoreAuthEvent<
      Change<DocumentSnapshot> | undefined,
      ParamsOf<'members/{memberId}'>
    >
  ) => {
    if (!event?.data) return;

    const rawDoc = event.document ?? '';
    const docPath = rawDoc.includes('/documents/')
      ? rawDoc.split('/documents/')[1] ?? rawDoc
      : rawDoc;

    const topLevelCollection = (docPath.split('/')[0] ?? '').trim();

    // ignore auditEvents always
    if (topLevelCollection === 'auditEvents') return;

    const { collectionFilterList, collectionFilterMode } = getConfig();

    const allowed = applyFilterList(
      [topLevelCollection],
      collectionFilterList,
      collectionFilterMode
    );
    if (allowed.length === 0) return;

    const memberId = event.params.memberId;
    if (!memberId) {
      console.error('Missing memberId param on event', {
        eventId: event.id,
        document: event.document
      });
      return;
    }

    const auditEvent = firestoreToAuditEvent({ event, documentId: memberId });
    if (!auditEvent) return;
    if (auditEvent.modifications.length === 0) return;

    ensureAdminInitialized();
    const db = getFirestore();
    const auditRef = db.collection('auditEvents').doc(auditEvent.eventId);
    await auditRef.set(auditEvent, { merge: false });
  };
}

// ---- exported Cloud Function remains the same shape ----
export const onDocumentWriteWithAuth = onDocumentWrittenWithAuthContext(
  'members/{memberId}',
  createAuditHandler()
);
//#pragma endregion
