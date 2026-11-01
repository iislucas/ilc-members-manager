/* functions/scripts/sync-stripe-subscriptions.ts
 *
 * Synchronizes active/existing Stripe subscriptions onto Firestore `/members` documents:
 *  - Repairs `membershipNextAutoRenewDate`, `instructorLicenseNextAutoRenewDate`, and
 *    `classVideoLibraryNextAutoRenewDate` so they reflect Stripe's actual `current_period_end`
 *    (rather than stacked access expiration dates).
 *  - Upserts `member.stripeSubscriptions[subId]` with authoritative recurring `amount`,
 *    `currency`, `interval`, `currentPeriodStart`, `currentPeriodEnd`, `nextAutoRenewDate`,
 *    and linked `schoolDocId` / `schoolId` / `schoolName` for School License subscriptions.
 *  - Preserves advance-purchased access expiration dates (`*Expires` / `*ExpirationDate`).
 *
 * Idempotent: safe to re-run at any time.
 *
 * Usage:
 *   # Dry run against current project:
 *   pnpm sync:stripe-subscriptions -- --dry-run
 *
 *   # Apply updates for all members with Stripe subscriptions:
 *   pnpm sync:stripe-subscriptions
 *
 *   # Target a single member document:
 *   pnpm sync:stripe-subscriptions -- --memberDocId <docId>
 *
 *   # Explicit project or Stripe secret key:
 *   pnpm sync:stripe-subscriptions -- --project ilc-paris-class-tracker --secret-key sk_...
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Stripe from 'stripe';
import * as admin from 'firebase-admin';
import { FirestoreCollection } from '../src/data-model/collections';
import {
  firestoreDocToMember,
  Member,
  MemberSubscriptionItem,
  MemberUpdates,
  SubscriptionItemType,
} from '../src/data-model/members';
import { firestoreDocToSchool, School } from '../src/data-model/schools';
import { buildMemberSubscriptionItemFromStripe } from '../src/stripe-subscriptions';

interface CliOptions {
  dryRun: boolean;
  project: string;
  secretKey: string;
  memberDocId: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    project: '',
    secretKey: '',
    memberDocId: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--':
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--project':
        if (next) {
          options.project = next;
          i += 1;
        }
        break;
      case '--secret-key':
        if (next) {
          options.secretKey = next;
          i += 1;
        }
        break;
      case '--memberDocId':
      case '--member-doc-id':
        if (next) {
          options.memberDocId = next;
          i += 1;
        }
        break;
      default:
        if (arg.startsWith('--project=')) {
          options.project = arg.split('=')[1];
        } else if (arg.startsWith('--secret-key=')) {
          options.secretKey = arg.split('=')[1];
        } else if (arg.startsWith('--memberDocId=') || arg.startsWith('--member-doc-id=')) {
          options.memberDocId = arg.split('=')[1];
        }
        break;
    }
  }

  return options;
}

function resolveGcpProjectId(explicitProject?: string): string {
  if (explicitProject) return explicitProject;
  if (process.env.GCP_PROJECT) return process.env.GCP_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.FIREBASE_CONFIG) {
    try {
      const cfg = JSON.parse(process.env.FIREBASE_CONFIG) as { projectId?: string };
      if (cfg.projectId) return cfg.projectId;
    } catch {
      // ignore
    }
  }

  const firebasercPath = path.resolve(__dirname, '../../.firebaserc');
  if (fs.existsSync(firebasercPath)) {
    try {
      const rc = JSON.parse(fs.readFileSync(firebasercPath, 'utf8')) as {
        projects?: { default?: string };
      };
      const active = rc.projects?.default;
      if (active) return active;
    } catch {
      // ignore
    }
  }

  return 'ilc-paris-class-tracker';
}

async function getStripeSecretKey(projectId: string, cliKey?: string): Promise<string> {
  if (cliKey) return cliKey;
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;

  try {
    const client = new SecretManagerServiceClient();
    const secretName = `projects/${projectId}/secrets/STRIPE_SECRET_KEY/versions/latest`;
    const [version] = await client.accessSecretVersion({ name: secretName });
    const payload = version.payload?.data?.toString();
    if (payload) return payload.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Could not read secret STRIPE_SECRET_KEY from Secret Manager: ${msg}`);
  }

  throw new Error(
    'No Stripe secret key found. Pass --secret-key=sk_... or set STRIPE_SECRET_KEY in env.',
  );
}

function collectMemberSubscriptionIds(member: Member): string[] {
  const ids = new Set<string>();
  if (member.membershipSubscriptionId) ids.add(member.membershipSubscriptionId);
  if (member.instructorLicenseSubscriptionId) ids.add(member.instructorLicenseSubscriptionId);
  if (member.classVideoLibrarySubscriptionId) ids.add(member.classVideoLibrarySubscriptionId);
  if (member.stripeSubscriptions) {
    for (const subId of Object.keys(member.stripeSubscriptions)) {
      if (subId) ids.add(subId);
    }
  }
  return Array.from(ids).filter((id) => id.startsWith('sub_'));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const projectId = resolveGcpProjectId(options.project);
  const secretKey = await getStripeSecretKey(projectId, options.secretKey);

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
    admin.firestore().settings({ ignoreUndefinedProperties: true });
  }
  const db = admin.firestore();
  const stripe = new Stripe(secretKey);

  console.log(
    `[sync-stripe-subscriptions] Project=${projectId} dryRun=${options.dryRun}`,
  );

  // Load schools once so unlinked SchoolLicense subscriptions can resolve school metadata
  const schoolsSnap = await db.collection(FirestoreCollection.Schools).get();
  const schools: School[] = schoolsSnap.docs.map(firestoreDocToSchool);
  const schoolByDocId = new Map<string, School>(schools.map((s) => [s.docId, s]));
  const schoolBySchoolId = new Map<string, School>(
    schools.filter((s) => Boolean(s.schoolId)).map((s) => [s.schoolId, s]),
  );

  const memberDocs: admin.firestore.QueryDocumentSnapshot[] = [];
  if (options.memberDocId) {
    const single = await db.collection(FirestoreCollection.Members).doc(options.memberDocId).get();
    if (!single.exists) {
      throw new Error(`Member document ${options.memberDocId} does not exist.`);
    }
    memberDocs.push(single as admin.firestore.QueryDocumentSnapshot);
  } else {
    const allMembersSnap = await db.collection(FirestoreCollection.Members).get();
    memberDocs.push(...allMembersSnap.docs);
  }

  let inspectedCount = 0;
  let updatedCount = 0;

  for (const doc of memberDocs) {
    const member = firestoreDocToMember(doc);
    const subIds = collectMemberSubscriptionIds(member);
    if (subIds.length === 0) continue;

    inspectedCount += 1;
    const nextSubsMap: Record<string, MemberSubscriptionItem> = {
      ...(member.stripeSubscriptions || {}),
    };
    const updates: MemberUpdates = {};
    let changed = false;

    for (const subId of subIds) {
      let liveSub: Stripe.Subscription;
      try {
        liveSub = await stripe.subscriptions.retrieve(subId, {
          expand: ['items.data.price.product', 'discounts'],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `  [WARN] Member ${member.docId} (${member.memberId}): could not retrieve ${subId}: ${msg}`,
        );
        continue;
      }

      const existing = nextSubsMap[subId];
      let schoolOverride: Partial<MemberSubscriptionItem> | undefined;
      const builtInitial = buildMemberSubscriptionItemFromStripe(liveSub, {
        existing,
        member,
      });

      if (builtInitial.type === SubscriptionItemType.SchoolLicense) {
        let matchedSchool: School | undefined;
        if (builtInitial.schoolDocId) {
          matchedSchool = schoolByDocId.get(builtInitial.schoolDocId);
        } else if (builtInitial.schoolId) {
          matchedSchool = schoolBySchoolId.get(builtInitial.schoolId);
        } else {
          const ownedSchools = schools.filter(
            (s) =>
              s.ownerMemberDocId === member.docId ||
              (member.instructorId && s.ownerInstructorId === member.instructorId),
          );
          if (ownedSchools.length === 1) {
            matchedSchool = ownedSchools[0];
          }
        }
        if (matchedSchool) {
          schoolOverride = {
            schoolDocId: matchedSchool.docId,
            schoolId: matchedSchool.schoolId,
            schoolName: matchedSchool.schoolName,
          };
        }
      }

      const syncedItem = buildMemberSubscriptionItemFromStripe(liveSub, {
        existing,
        member,
        overrides: schoolOverride,
      });

      if (JSON.stringify(existing) !== JSON.stringify(syncedItem)) {
        nextSubsMap[subId] = syncedItem;
        changed = true;
      }

      if (
        member.membershipSubscriptionId === subId &&
        member.membershipNextAutoRenewDate !== syncedItem.nextAutoRenewDate
      ) {
        updates.membershipNextAutoRenewDate = syncedItem.nextAutoRenewDate;
        changed = true;
      }
      if (
        member.instructorLicenseSubscriptionId === subId &&
        member.instructorLicenseNextAutoRenewDate !== syncedItem.nextAutoRenewDate
      ) {
        updates.instructorLicenseNextAutoRenewDate = syncedItem.nextAutoRenewDate;
        changed = true;
      }
      if (
        member.classVideoLibrarySubscriptionId === subId &&
        member.classVideoLibraryNextAutoRenewDate !== syncedItem.nextAutoRenewDate
      ) {
        updates.classVideoLibraryNextAutoRenewDate = syncedItem.nextAutoRenewDate;
        changed = true;
      }
    }

    if (!changed) continue;

    updatedCount += 1;
    updates.stripeSubscriptions = nextSubsMap;
    updates.lastUpdated = admin.firestore.FieldValue.serverTimestamp();

    console.log(
      `  [${options.dryRun ? 'DRY-RUN' : 'UPDATE'}] Member ${member.docId} (${member.memberId || 'no-id'}):`,
      {
        membershipNextAutoRenewDate: updates.membershipNextAutoRenewDate,
        instructorLicenseNextAutoRenewDate: updates.instructorLicenseNextAutoRenewDate,
        classVideoLibraryNextAutoRenewDate: updates.classVideoLibraryNextAutoRenewDate,
        subscriptionCount: Object.keys(nextSubsMap).length,
      },
    );

    if (!options.dryRun) {
      await db.collection(FirestoreCollection.Members).doc(member.docId).update(updates);
    }
  }

  console.log(
    `[sync-stripe-subscriptions] Done. Inspected ${inspectedCount} member(s) with subscriptions; ${
      options.dryRun ? 'would update' : 'updated'
    } ${updatedCount}.`,
  );
}

main().catch((err: unknown) => {
  console.error('[sync-stripe-subscriptions] Fatal error:', err);
  process.exitCode = 1;
});
