/*
 * Check Notifications Script (READ-ONLY)
 *
 * Scans every member notification document and reports anything that would make
 * it invisible to the homepage feed, which queries:
 *     where('dismissed', '==', false)
 *
 * That equality filter only matches docs where `dismissed` is exactly the
 * boolean `false`. Any notification where `dismissed` is missing, null, or a
 * non-boolean (e.g. the string "false") is silently dropped from the feed.
 *
 * The script writes nothing; it only reads and prints a report.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/check-notifications.ts [--project <PROJECT_ID>] [--sample 20]
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
  })
  .option('sample', {
    type: 'number',
    default: 20,
    describe: 'How many problem docs to print as examples',
  })
  .parseSync();

const projectId =
  argv.project ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

// Path of a notification doc -> "members/{memberDocId}/notifications/{id}".
function memberDocIdFromPath(path: string): string {
  const parts = path.split('/');
  // members / {memberDocId} / notifications / {id}
  return parts.length >= 2 ? parts[1] : '(unknown)';
}

async function main() {
  console.log(`\n🔍 Scanning member notifications`);
  console.log(`   Project: ${projectId}\n`);

  // collectionGroup picks up every `notifications` subcollection across members.
  const snap = await db.collectionGroup('notifications').get();
  console.log(`📋 Total notification documents: ${snap.size}\n`);

  const missing: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const nullValued: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const nonBoolean: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let visibleUnread = 0; // dismissed === false  (what the feed actually shows)
  let dismissedTrue = 0; // dismissed === true

  // Per-member tally of how many notifications are hidden by a bad `dismissed`.
  const hiddenByMember = new Map<string, number>();

  for (const doc of snap.docs) {
    const data = doc.data();
    const has = Object.prototype.hasOwnProperty.call(data, 'dismissed');
    const value = (data as { dismissed?: unknown }).dismissed;

    if (!has) {
      missing.push(doc);
    } else if (value === null) {
      nullValued.push(doc);
    } else if (typeof value !== 'boolean') {
      nonBoolean.push(doc);
    } else if (value === false) {
      visibleUnread++;
      continue; // healthy, visible
    } else {
      dismissedTrue++;
      continue; // healthy, intentionally hidden
    }

    // If we reach here, the doc is unread-but-invisible due to a bad field.
    const memberDocId = memberDocIdFromPath(doc.ref.path);
    hiddenByMember.set(memberDocId, (hiddenByMember.get(memberDocId) || 0) + 1);
  }

  const brokenTotal = missing.length + nullValued.length + nonBoolean.length;

  console.log('─'.repeat(70));
  console.log('Notification `dismissed` field health');
  console.log('─'.repeat(70));
  console.log(`  ✅ Visible (dismissed === false):      ${visibleUnread}`);
  console.log(`  ✅ Dismissed (dismissed === true):     ${dismissedTrue}`);
  console.log(`  ❌ Missing the field entirely:         ${missing.length}`);
  console.log(`  ❌ Present but null:                   ${nullValued.length}`);
  console.log(`  ❌ Present but non-boolean:            ${nonBoolean.length}`);
  console.log('─'.repeat(70));
  console.log(
    `  ⚠️  Total "ghost" notifications (unread but hidden from the feed): ${brokenTotal}`,
  );
  console.log(`  ⚠️  Affected members: ${hiddenByMember.size}`);
  console.log('─'.repeat(70));

  const printSamples = (
    label: string,
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
  ) => {
    if (docs.length === 0) return;
    console.log(`\n${label} (showing up to ${argv.sample}):`);
    for (const doc of docs.slice(0, argv.sample)) {
      const data = doc.data() as {
        dismissed?: unknown;
        kind?: string;
        createdAt?: string;
        markdown?: string;
      };
      const md = (data.markdown || '').replace(/\s+/g, ' ').slice(0, 50);
      console.log(
        `  • ${doc.ref.path}\n` +
          `      kind=${data.kind ?? '(none)'} createdAt=${data.createdAt ?? '(none)'} ` +
          `dismissed=${JSON.stringify(data.dismissed)} (${typeof data.dismissed})\n` +
          `      "${md}${md.length === 50 ? '…' : ''}"`,
      );
    }
  };

  printSamples('❌ Docs MISSING `dismissed`', missing);
  printSamples('❌ Docs with `dismissed: null`', nullValued);
  printSamples('❌ Docs with non-boolean `dismissed`', nonBoolean);

  if (hiddenByMember.size > 0) {
    const top = [...hiddenByMember.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, argv.sample);
    console.log(`\nMembers with the most hidden notifications (top ${argv.sample}):`);
    for (const [memberDocId, count] of top) {
      console.log(`  • members/${memberDocId}: ${count} hidden`);
    }
  }

  console.log('\n' + '='.repeat(70));
  if (brokenTotal === 0) {
    console.log('✅ Every notification has a proper boolean `dismissed` field.');
    console.log('   The homepage feed query is not dropping any docs on this basis.');
  } else {
    console.log(
      `❌ ${brokenTotal} notification(s) across ${hiddenByMember.size} member(s) are unread but`,
    );
    console.log('   hidden from the homepage feed because of a bad `dismissed` field.');
    console.log('   These can be repaired by backfilling `dismissed: false`.');
  }
  console.log('='.repeat(70));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
