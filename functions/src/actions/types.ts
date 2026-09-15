/* types.ts
 *
 * Core types and interfaces for the ILC database actions library.
 * Defines the execution context, actor metadata, result wrappers, and
 * query/update specifications used across all domain action functions.
 */

import * as admin from 'firebase-admin';

/**
 * Identity metadata for the agent, user, or automated script initiating the action.
 */
export interface ActionActor {
  /** Firestore document ID of the member record, if bound to an authenticated member. */
  memberDocId?: string;
  /** Human-facing member ID (e.g. 'US402'). */
  memberId?: string;
  /** Full display name snapshot (e.g. 'Lucas Dixon'). */
  name?: string;
  /** Email address associated with the actor. */
  email?: string;
  /** Whether the actor possesses administrative privileges. */
  isAdmin?: boolean;
}

/**
 * Shared execution context passed to all database actions.
 */
export interface ActionContext {
  /** Authorized Firestore database instance. */
  db: admin.firestore.Firestore;
  /** Optional actor identity performing the action (for audit logs and status author snapshots). */
  actor?: ActionActor;
  /**
   * When true, actions execute argument validation, queries, and state calculations,
   * but DO NOT commit any writes or mutations to Firestore.
   */
  dryRun?: boolean;
  /** Optional logging function for diagnostic and trace output. */
  logger?: (message: string, ...args: unknown[]) => void;
}

/**
 * Standard envelope returned by all action mutations.
 */
export interface ActionResult<T = void> {
  /** True if the action succeeded without errors. */
  success: boolean;
  /** Result payload if successful. */
  data?: T;
  /** Human-readable error message if unsuccessful. */
  error?: string;
  /** Indicates whether the result was produced during a dry-run execution. */
  dryRun?: boolean;
  /** Optional informational messages or audit notes generated during execution. */
  notes?: string[];
}
