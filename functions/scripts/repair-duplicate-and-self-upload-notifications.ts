/*
 * Cleanup / Repair Notifications Script
 *
 * 1. Identifies and removes duplicate notifications (same member, same kind, same entity / markdown / createdAt).
 * 2. Marks self-upload notifications (where the uploader is the member receiving the notification) as dismissed.
 * 3. Marks orphan upload summary notifications as dismissed.
 *
 * Usage:
 *   cd functions
 *   # Dry run (read-only report):
 *   pnpm exec ts-node scripts/repair-duplicate-and-self-upload-notifications.ts [--project <PROJECT_ID>] [--member <MEMBER_DOC_ID>]
 *
 *   # Apply fixes:
 *   pnpm exec ts-node scripts/repair-duplicate-and-self-upload-notifications.ts --fix [--project <PROJECT_ID>] [--member <MEMBER_DOC_ID>]
 */

import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
  })
  .option('member', {
    type: 'string',
    description: 'Specific member docId to repair (repairs all if omitted)',
  })
  .option('fix', {
    type: 'boolean',
    default: false,
    description: 'Apply changes to Firestore (dry-run if false)',
  })
  .parseSync();

const projectId =
  argv.project ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  'ilc-paris-class-tracker';

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

function memberDocIdFromPath(path: string): string {
  const parts = path.split('/');
  return parts.length >= 2 ? parts[1] : '(unknown)';
}

function entityKeyOf(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  for (const field of ['uploadDocId', 'eventId', 'gradingDocId', 'orderDocId', 'orderId', 'blogPostId']) {
    if (data[field]) return `${field}:${data[field]}`;
  }
  return '';
}

async function main() {
  const isFix = argv.fix;
  console.log(`\n🧹 Notifications Cleanup & Repair`);
  console.log(`   Project: ${projectId}`);
  console.log(`   Mode:    ${isFix ? '🔥 APPLY FIXES' : '👀 DRY RUN (read-only)'}`);
  if (argv.member) {
    console.log(`   Member:  ${argv.member}`);
  }
  console.log('─'.repeat(70));

  const query: FirebaseFirestore.Query = db.collectionGroup('notifications');
  const snap = await query.get();

  console.log(`Total notifications in database: ${snap.size}\n`);

  // Group notifications by memberDocId
  const memberNotifs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const doc of snap.docs) {
    const memberDocId = memberDocIdFromPath(doc.ref.path);
    if (argv.member && memberDocId !== argv.member) continue;
    if (!memberNotifs.has(memberDocId)) {
      memberNotifs.set(memberDocId, []);
    }
    memberNotifs.get(memberDocId)!.push(doc);
  }

  let totalDuplicatesDeleted = 0;
  let totalSelfUploadsDismissed = 0;
  let totalSummariesDismissed = 0;

  for (const [memberDocId, docs] of memberNotifs.entries()) {
    // Sort by createdAt ascending so we keep the first/original doc and delete subsequent duplicates
    docs.sort((a, b) => {
      const ca = a.data().createdAt || '';
      const cb = b.data().createdAt || '';
      return ca.localeCompare(cb);
    });

    const seenKeys = new Set<string>();
    const toDelete: FirebaseFirestore.DocumentReference[] = [];
    const toDismiss: FirebaseFirestore.DocumentReference[] = [];

    for (const doc of docs) {
      const d = doc.data();
      const kind = d.kind || '';
      const entity = entityKeyOf(d.data as Record<string, unknown>);
      const createdAt = d.createdAt || '';
      const markdown = d.markdown || '';

      // Deduplication key
      const dedupKey = entity
        ? `${kind}::${entity}`
        : `${kind}::${createdAt}::${markdown}`;

      if (seenKeys.has(dedupKey)) {
        toDelete.push(doc.ref);
        totalDuplicatesDeleted++;
        continue;
      }
      seenKeys.add(dedupKey);

      // Check if self-upload notification that is still unread
      if (kind === 'NewUpload' && d.dismissed === false) {
        const uploaderDocId = d.data?.memberDocId;
        if (uploaderDocId === memberDocId) {
          toDismiss.push(doc.ref);
          totalSelfUploadsDismissed++;
        }
      }

      // Check if upload summary on June 5 or self-only uploads
      if (kind === 'NewUploadsSummary' && d.dismissed === false) {
        // Dismiss self-upload summaries
        if (d.data?.startDate === '2026-06-05' && d.data?.endDate === '2026-06-05') {
          toDismiss.push(doc.ref);
          totalSummariesDismissed++;
        }
      }
    }

    if (toDelete.length > 0 || toDismiss.length > 0) {
      console.log(`Member ${memberDocId}:`);
      if (toDelete.length > 0) {
        console.log(`  - 🗑️  ${toDelete.length} duplicate notification(s) to delete`);
      }
      if (toDismiss.length > 0) {
        console.log(`  - 👁️  ${toDismiss.length} self-upload/summary notification(s) to mark as dismissed`);
      }

      if (isFix) {
        const batch = db.batch();
        for (const ref of toDelete) {
          batch.delete(ref);
        }
        for (const ref of toDismiss) {
          batch.update(ref, { dismissed: true });
        }
        await batch.commit();
      }
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Summary:`);
  console.log(`  • Duplicates to remove:           ${totalDuplicatesDeleted}`);
  console.log(`  • Self-uploads to mark dismissed:  ${totalSelfUploadsDismissed}`);
  console.log(`  • Summaries to mark dismissed:     ${totalSummariesDismissed}`);
  console.log('─'.repeat(70));

  if (!isFix) {
    console.log(`\nRun with --fix to apply these changes.`);
  } else {
    console.log(`\n✅ Changes applied successfully.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
