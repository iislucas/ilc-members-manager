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
