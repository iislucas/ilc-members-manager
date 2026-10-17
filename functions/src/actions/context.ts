/* context.ts
 *
 * Provides factory functions to initialize and construct ActionContext instances
 * for scripts, tests, and cloud functions.
 */

import * as admin from 'firebase-admin';
import { ActionActor, ActionContext } from './types';

export interface CreateActionContextOptions {
  /** Target Firebase project ID. If omitted, uses environment variables or default app. */
  projectId?: string;
  /** Explicit Firestore database instance. If provided, overrides default initialization. */
  db?: admin.firestore.Firestore;
  /** Optional actor identity performing the actions. */
  actor?: ActionActor;
  /** When true, actions execute without persisting writes. */
  dryRun?: boolean;
  /** Optional custom logger function. Defaults to console.log. */
  logger?: (message: string, ...args: unknown[]) => void;
}

/**
 * Creates an ActionContext configured for scripting or background execution.
 * If Firebase Admin has not been initialized yet, it safely initializes with
 * the provided project ID or environment credentials.
 */
export function createActionContext(options?: CreateActionContextOptions): ActionContext {
  let db = options?.db;

  if (!db) {
    if (admin.apps.length === 0) {
      const projectId =
        options?.projectId ||
        process.env['GCLOUD_PROJECT'] ||
        process.env['GOOGLE_CLOUD_PROJECT'] ||
        'ilc-paris-class-tracker';

      admin.initializeApp({ projectId });
    }
    db = admin.firestore();
  }

  const dryRun = Boolean(options?.dryRun);
  const logger = options?.logger || ((msg: string, ...args: unknown[]) => {
    if (dryRun) {
      console.log(`[DRY-RUN] ${msg}`, ...args);
    } else {
      console.log(msg, ...args);
    }
  });

  return {
    db,
    actor: options?.actor,
    dryRun,
    logger,
  };
}

/**
 * Resolves the admin member a script acts as, from a member docId, memberId or
 * email. Returns the actor to put on the ActionContext, or an error message.
 *
 * Why this exists: scripts run with Admin SDK credentials, so Firestore
 * security rules do not apply to them — only people with IAM access to the
 * Firebase project can run them at all. But server triggers still decide what
 * a write means from who made it (e.g. `onGradingUpdated` lets admins record
 * results out of order, judged by `statusChangedByMemberDocId`). Acting as a
 * named admin member makes every write carry that admin's identity, so
 * triggers treat it as the admin action it is, and the audit trail names them.
 */
export async function resolveAdminActor(
  db: admin.firestore.Firestore,
  idOrEmail: string,
): Promise<ActionActor | string> {
  const key = (idOrEmail || '').trim();
  if (!key) return 'An admin member (--as) is required for this action.';
  const members = db.collection('members');
  let snap: admin.firestore.DocumentSnapshot | undefined = await members.doc(key).get();
  if (!snap.exists) {
    const field = key.includes('@') ? 'emails' : 'memberId';
    const q = key.includes('@')
      ? await members.where(field, 'array-contains', key.toLowerCase()).limit(1).get()
      : await members.where(field, '==', key.toUpperCase()).limit(1).get();
    snap = q.empty ? undefined : q.docs[0];
  }
  if (!snap || !snap.exists) return `No member found for "${key}".`;
  const data = snap.data() as { isAdmin?: boolean; memberId?: string; name?: string; emails?: string[] };
  if (data.isAdmin !== true) {
    return `Member "${key}" is not an admin; scripts may only act as an admin.`;
  }
  return {
    memberDocId: snap.id,
    memberId: data.memberId || '',
    name: data.name || '',
    email: data.emails?.[0] || '',
    isAdmin: true,
  };
}
