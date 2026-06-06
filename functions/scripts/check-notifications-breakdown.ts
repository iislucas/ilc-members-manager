/*
 * Notifications breakdown (READ-ONLY).
 *
 * Helps explain "nobody is getting notifications" by showing whether
 * notifications are being CREATED at all, broken down by kind, and how the
 * counts compare to the member / blog-post population that should be generating
 * them. Writes nothing.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/check-notifications-breakdown.ts [--project <PROJECT_ID>]
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('project', { type: 'string' })
  .parseSync();

const projectId =
  argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  console.log(`\n🔍 Notifications breakdown — project: ${projectId}\n`);

  const notifSnap = await db.collectionGroup('notifications').get();

  const byKind = new Map<string, number>();
  const membersWithNotifs = new Set<string>();
  let newest = '';
  let oldest = '';
  for (const doc of notifSnap.docs) {
    const d = doc.data() as { kind?: string; createdAt?: string };
    byKind.set(d.kind || '(none)', (byKind.get(d.kind || '(none)') || 0) + 1);
    const memberDocId = doc.ref.path.split('/')[1];
    membersWithNotifs.add(memberDocId);
    const c = d.createdAt || '';
    if (c && (!newest || c > newest)) newest = c;
    if (c && (!oldest || c < oldest)) oldest = c;
  }

  console.log(`Total notifications: ${notifSnap.size}`);
  console.log(`Members with >=1 notification: ${membersWithNotifs.size}`);
  console.log(`Date range: ${oldest || '(none)'}  ->  ${newest || '(none)'}`);
  console.log('\nBy kind:');
  for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(34)} ${count}`);
  }

  // Population context: how many members / blog posts exist that *should* be
  // driving notification creation.
  const membersSnap = await db.collection('members').select().get();
  console.log(`\nTotal members: ${membersSnap.size}`);

  for (const coll of ['members-post', 'instructors-post']) {
    try {
      const s = await db.collection(coll).select().get();
      console.log(`Total ${coll}: ${s.size}`);
    } catch (e) {
      console.log(`Total ${coll}: (error reading) ${(e as Error).message}`);
    }
  }

  console.log('\nNote: BlogPost notifications are created CLIENT-SIDE the next');
  console.log('time each member opens the app (syncBlogPostNotifications), so a');
  console.log('low BlogPost count means few members have opened the app since');
  console.log('that feature shipped — not necessarily a bug.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
