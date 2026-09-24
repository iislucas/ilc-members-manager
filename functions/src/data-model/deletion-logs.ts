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

/**
 * High-level category of what triggered the deletion (MECE).
 */
export enum DeletionTriggerKind {
  /** Directly initiated by an authenticated user or admin */
  DirectUser = 'direct_user',

  /** Cascaded automatically because another Firestore document was deleted or updated */
  Cascaded = 'cascaded',

  /** Automated background system task, retention policy, or scheduled maintenance */
  SystemLifecycle = 'system_lifecycle',

  /** Executed via an administrative CLI script or migration tool */
  AdminScript = 'admin_script',
}

/**
 * Specific reason / case when a deletion cascades from another document's change (MECE).
 */
export enum CascadeCase {
  /** Member profile deleted -> Cascades to public instructor profile (/instructors/{id}) */
  MemberDeletedToInstructorProfile = 'member_deleted_to_instructor_profile',

  /** Member profile deleted -> Cascades to school member view (/schools/{id}/members/{id}) */
  MemberDeletedToSchoolView = 'member_deleted_to_school_view',

  /** Member profile deleted -> Cascades to instructor student view (/instructors/{id}/members/{id}) */
  MemberDeletedToInstructorView = 'member_deleted_to_instructor_view',

  /** Member profile deleted -> Cascades to ACL cleanup if no profiles remain */
  MemberDeletedToAcl = 'member_deleted_to_acl',

  /** Member's instructor license expired or was revoked -> Public instructor profile removed */
  InstructorLicenseRevoked = 'instructor_license_revoked',

  /** Member primary school changed -> Old school view mirror removed */
  MemberSchoolChanged = 'member_school_changed',

  /** Member primary instructor changed -> Old instructor student view mirror removed */
  MemberInstructorChanged = 'member_instructor_changed',

  /** School deleted -> Cascades to school manager ACLs or mirrors */
  SchoolDeleted = 'school_deleted',

  /** Grading deleted -> Cascades to member/school subcollection mirrors */
  GradingDeleted = 'grading_deleted',

  /** Grading instructor changed -> Old instructor grading view mirror removed */
  GradingInstructorChanged = 'grading_instructor_changed',

  /** Grading school changed -> Old school grading view mirror removed */
  GradingSchoolChanged = 'grading_school_changed',

  /** Event deleted -> Cascades to member subcollection mirrors and storage */
  EventDeletedToMemberView = 'event_deleted_to_member_view',

  /** Video deleted from catalog -> Unlinks upload references */
  VideoDeleted = 'video_deleted',

  /** Web push subscription unregistered/expired -> Stale token document deleted */
  StalePushSubscription = 'stale_push_subscription',
}

/** Direct deletion initiated by an authenticated user or admin */
export interface DirectUserDeletionTrigger {
  kind: DeletionTriggerKind.DirectUser;
  email: string;
  name?: string;
  uid?: string;
}

/** Deletion cascaded from another document's change or deletion */
export interface CascadedDeletionTrigger {
  kind: DeletionTriggerKind.Cascaded;
  cascadeCase: CascadeCase;
  /** Collection name of the source document that triggered this cascade (e.g. 'members', 'schools') */
  sourceCollection: string;
  /** Document ID of the source document */
  sourceDocId: string;
  /** Human-readable name or label of the source document (e.g. member name, school name, event title) */
  sourceName?: string;
  /** Initiating user email if known and propagated from the root trigger */
  initiatingUserEmail?: string;
}

/** Automated background system task or maintenance lifecycle */
export interface SystemLifecycleDeletionTrigger {
  kind: DeletionTriggerKind.SystemLifecycle;
  processName: string;
  reason?: string;
}

/** Executed via an administrative CLI script or migration tool */
export interface AdminScriptDeletionTrigger {
  kind: DeletionTriggerKind.AdminScript;
  scriptName: string;
  operator?: string;
}

/**
 * MECE discriminated union describing why and by whom a Firestore document was deleted.
 */
export type DeletionTrigger =
  | DirectUserDeletionTrigger
  | CascadedDeletionTrigger
  | SystemLifecycleDeletionTrigger
  | AdminScriptDeletionTrigger;

/** Returns human-readable summary fields from any DeletionTrigger */
export function describeDeletionTrigger(trigger: DeletionTrigger): {
  deletedBy: string;
  deletedByName?: string;
  deletedByUid?: string;
} {
  switch (trigger.kind) {
    case DeletionTriggerKind.DirectUser:
      return {
        deletedBy: trigger.email.trim() || 'unknown',
        deletedByName: trigger.name?.trim() || undefined,
        deletedByUid: trigger.uid?.trim() || undefined,
      };
    case DeletionTriggerKind.Cascaded: {
      const email = trigger.initiatingUserEmail?.trim();
      const validEmail = email && email !== 'unknown' && email.includes('@') ? email : undefined;
      return {
        deletedBy: validEmail || `cascaded:${trigger.sourceCollection}/${trigger.sourceDocId}`,
        deletedByName: trigger.sourceName
          ? `Cascaded from ${trigger.sourceName} (${trigger.cascadeCase})`
          : `Cascaded from ${trigger.sourceCollection}/${trigger.sourceDocId} (${trigger.cascadeCase})`,
        deletedByUid: undefined,
      };
    }
    case DeletionTriggerKind.SystemLifecycle:
      return {
        deletedBy: `system:${trigger.processName}`,
        deletedByName: trigger.reason || trigger.processName,
        deletedByUid: undefined,
      };
    case DeletionTriggerKind.AdminScript:
      return {
        deletedBy: trigger.operator?.trim() || `script:${trigger.scriptName}`,
        deletedByName: `Script: ${trigger.scriptName}`,
        deletedByUid: undefined,
      };
  }
}

export interface DeletionLogEntry<T extends object = Record<string, unknown>> {
  /** Generated unique document ID for this log entry */
  id?: string;
  /** Name of the collection the document was deleted from (e.g. 'members', 'schools') */
  collectionName: string;
  /** Document ID of the deleted entity */
  docId: string;
  /** Firestore Timestamp when the deletion occurred / was recorded */
  deletedAt: FsTimestamp;
  /** Email, source document reference, or system identifier of who/what triggered the deletion */
  deletedBy: string;
  /** Display name of the actor or human-readable cascade description */
  deletedByName?: string;
  /** Firebase Auth UID of the actor if authenticated */
  deletedByUid?: string;
  /** How the deletion was triggered at technical boundary */
  source: DeletionSource;
  /** Full MECE audit details of the trigger / cause */
  trigger: DeletionTrigger;
  /** Complete pre-deletion snapshot of the document */
  data: T;
}
