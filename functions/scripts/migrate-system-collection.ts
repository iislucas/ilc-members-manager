import * as admin from 'firebase-admin';

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');

  const projectIndex = args.indexOf('--project');
  let projectId: string | undefined;
  if (projectIndex !== -1 && args.length > projectIndex + 1) {
    projectId = args[projectIndex + 1];
  } else {
    projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  }

  admin.initializeApp(projectId ? { projectId } : undefined);
  const db = admin.firestore();

  console.log('Starting migration to system collection...');
  if (isDryRun) {
    console.log('*** DRY RUN MODE ***');
    console.log('Changes will not be written to Firestore');
  }

  const migrations = [
    { from: 'counters/singleton', to: 'system/counters' },
    { from: 'static/country-codes', to: 'system/country-codes' },
    { from: 'systemInfo/squarespaceSync', to: 'system/squarespaceSync' },
  ];

  for (const { from, to } of migrations) {
    console.log(`Migrating ${from} -> ${to}...`);
    const docRef = db.doc(from);
    const docSnap = await docRef.get();
    
    if (!docSnap.exists) {
      console.log(` - Source document ${from} does not exist. Skipping.`);
      continue;
    }
    
    if (!isDryRun) {
      const data = docSnap.data();
      if (data) {
        await db.doc(to).set(data);
        console.log(` - Successfully copied data to ${to}`);
        await docRef.delete();
        console.log(` - Successfully deleted original document at ${from}`);
      }
    } else {
      console.log(` - [DRY RUN] Would copy data to ${to} and delete ${from}`);
    }
  }

  console.log('Migration finished.');
  process.exit(0);
}

main();
