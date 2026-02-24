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

  console.log('Starting migration of schools to Firebase DocIDs...');
  if (isDryRun) {
    console.log('*** DRY RUN MODE ***');
    console.log('Changes will not be written to Firestore');
  }

  const schoolsSnapshot = await db.collection('schools').get();
  
  if (schoolsSnapshot.empty) {
    console.log('No schools found.');
    return;
  }

  let migratedCount = 0;
  let skippedCount = 0;

  for (const doc of schoolsSnapshot.docs) {
    const schoolId = doc.id;
    const data = doc.data();

    // If the doc name is 20 characters and doesn't start with SCH-, it might already be an auto ID
    // But to be safe, we just check if it MATCHES the human readable ID
    if (schoolId !== data.schoolId) {
      console.log(` - School ${data.schoolName} (ID: ${schoolId}) already has an auto-like ID or doesn't match its readable schoolId. Skipping.`);
      skippedCount++;
      continue;
    }

    // It matches SCH-XXX, we want to migrate it
    const newDocRef = db.collection('schools').doc();
    const newDocId = newDocRef.id;

    console.log(`Migrating school ${data.schoolName} from doc ID ${schoolId} to new doc ID ${newDocId}...`);

    if (!isDryRun) {
      // 1. Copy the main document
      await newDocRef.set(data);
      console.log(`   Copied main document to ${newDocId}`);

      // 2. Copy the members subcollection
      const membersSubcollection = await db.collection('schools').doc(schoolId).collection('members').get();
      if (!membersSubcollection.empty) {
        const batch = db.batch();
        membersSubcollection.forEach(memberDoc => {
          batch.set(newDocRef.collection('members').doc(memberDoc.id), memberDoc.data());
          batch.delete(memberDoc.ref); // Schedule deletion of old subcollection doc
        });
        await batch.commit();
        console.log(`   Copied ${membersSubcollection.size} members to new subcollection and deleted old subcollection docs.`);
      }

      // 3. Update all members that point to this school as their managingOrgId
      const managedMembersSnapshot = await db.collection('members').where('managingOrgId', '==', schoolId).get();
      if (!managedMembersSnapshot.empty) {
        const batch = db.batch();
        managedMembersSnapshot.forEach(memberDoc => {
          batch.update(memberDoc.ref, { managingOrgId: newDocId });
        });
        await batch.commit();
        console.log(`   Updated ${managedMembersSnapshot.size} members to point to managingOrgId ${newDocId}.`);
      }

      // 4. Delete the old document
      await db.collection('schools').doc(schoolId).delete();
      console.log(`   Deleted old document ${schoolId}.`);
      migratedCount++;
    } else {
      console.log(`   [DRY RUN] Would copy main document to ${newDocId}.`);
      
      const membersSubcollection = await db.collection('schools').doc(schoolId).collection('members').get();
      if (!membersSubcollection.empty) {
        console.log(`   [DRY RUN] Would copy ${membersSubcollection.size} members to new subcollection and delete old ones.`);
      }

      const managedMembersSnapshot = await db.collection('members').where('managingOrgId', '==', schoolId).get();
      if (!managedMembersSnapshot.empty) {
        console.log(`   [DRY RUN] Would update ${managedMembersSnapshot.size} members to point to managingOrgId ${newDocId}.`);
      }

      console.log(`   [DRY RUN] Would delete old document ${schoolId}.`);
      migratedCount++;
    }
  }

  console.log(`\nMigration completed.`);
  console.log(`Migrated: ${migratedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  process.exit(0);
}

main().catch(console.error);
