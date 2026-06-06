/*
 * Inspect cached blog-post docs (READ-ONLY).
 *
 * The client blog catch-up (syncBlogFeedNotifications) lists posts with
 * orderBy('publishOn', 'desc'). Firestore's orderBy silently drops any doc that
 * lacks the field, so if cached posts have no `publishOn` the query returns
 * nothing and no BlogPost notifications are ever created. This prints the field
 * shape of each post so we can confirm. Writes nothing.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/check-blogpost-fields.ts [--project <PROJECT_ID>]
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv)).option('project', { type: 'string' }).parseSync();
const projectId =
  argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  console.log(`\n🔍 Cached blog-post field check — project: ${projectId}\n`);

  for (const coll of ['members-post', 'instructors-post']) {
    const snap = await db.collection(coll).get();
    let withPublishOn = 0;
    let missingPublishOn = 0;
    const types = new Map<string, number>();

    snap.docs.forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      const has = Object.prototype.hasOwnProperty.call(d, 'publishOn') && d.publishOn != null;
      if (has) withPublishOn++;
      else missingPublishOn++;
      const t = `${typeof d.publishOn}`;
      types.set(t, (types.get(t) || 0) + 1);
    });

    console.log('─'.repeat(60));
    console.log(`Collection: ${coll}  (total ${snap.size})`);
    console.log(`  has publishOn (non-null): ${withPublishOn}`);
    console.log(`  missing/null publishOn:   ${missingPublishOn}`);
    console.log(`  publishOn types: ${[...types.entries()].map(([t, c]) => `${t}=${c}`).join(', ')}`);

    // Does the actual production query return anything?
    const q = await db.collection(coll).orderBy('publishOn', 'desc').limit(3).get();
    console.log(`  orderBy('publishOn','desc').limit(3) returns: ${q.size} doc(s)`);

    // Show one sample doc's keys to see what date field is actually present.
    if (snap.size > 0) {
      const sample = snap.docs[0].data() as Record<string, unknown>;
      console.log(`  sample doc id: ${snap.docs[0].id}`);
      console.log(`  sample keys: ${Object.keys(sample).sort().join(', ')}`);
      const dateLike = Object.keys(sample).filter((k) =>
        /date|publish|time|created|updated|on$/i.test(k),
      );
      for (const k of dateLike) {
        console.log(`    ${k} = ${JSON.stringify(sample[k])} (${typeof sample[k]})`);
      }
    }
    console.log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
