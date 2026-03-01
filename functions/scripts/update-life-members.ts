/*
Updates member records based on legacy "Life" orders from imported sheets.

Iterates over all orders. For any order that is a "sheets order"
(ilcAppOrderKind === 'ilc-2005-sheets-db-import') and where the "Description"
columns ('paidFor', 'orderType', or 'notes') contain the text "Life", it attempts
to look up the corresponding member:
1. By member ID (using order.externalId)
2. By email (using order.email)
3. By name (using order.firstName + " " + order.lastName)

If a member is found, it updates their `membershipType` to 'Life'.

Usage:
  cd functions
  pnpm run update-life-members [--project <PROJECT_ID>] [--dry-run]

Examples:
  # Run in dry-run mode (don't write any results back to Firestore):
  pnpm run update-life-members --dry-run
*/
import * as admin from 'firebase-admin';
import { MembershipType, SheetsImportOrder } from '../src/data-model';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
    demandOption: false,
  })
  .option('dry-run', {
    type: 'boolean',
    description: 'If true, no results will be written back to Firestore',
    default: false,
  })
  .parseSync();

async function main() {
  const isDryRun = argv['dry-run'];
  const projectId = argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    console.warn('⚠️ No project ID found. Use --project or set GCLOUD_PROJECT env var.');
    console.warn('Attempting to use default credentials...');
  }

  admin.initializeApp(projectId ? { projectId } : undefined);
  const db = admin.firestore();

  console.log(`\n🔍 Fetching all orders...`);
  const ordersSnap = await db.collection('orders').get();
  console.log(`✅ Loaded ${ordersSnap.size} orders.\n`);

  let processedCount = 0;
  let updatedCount = 0;
  let notFoundCount = 0;

  for (const doc of ordersSnap.docs) {
    const data = doc.data();

    // Check if it's a "sheets order" (ilcAppOrderKind == 'ilc-2005-sheets-db-import' or missing which defaults to it)
    const orderKind = data.ilcAppOrderKind || 'ilc-2005-sheets-db-import';
    if (orderKind !== 'ilc-2005-sheets-db-import') {
      continue;
    }

    const order = data as SheetsImportOrder & { docId: string };
    order.docId = doc.id;

    // The "Description" column in the UI consists of paidFor, orderType, and notes.
    const description = [order.paidFor, order.orderType, order.notes].filter(Boolean).join(' ');

    if (description.includes('Life')) {
      processedCount++;
      console.log(`-----------------------------------------------------`);
      console.log(`Found Life order: ${order.docId}`);
      console.log(`Description: "${description}"`);

      let memberSnap: admin.firestore.QuerySnapshot | admin.firestore.DocumentSnapshot | undefined;
      let targetMemberDoc: admin.firestore.DocumentSnapshot | undefined;

      // 1. By member ID
      if (order.externalId) {
        memberSnap = await db.collection('members').where('memberId', '==', order.externalId.trim()).limit(1).get();
        if (!memberSnap.empty) {
          targetMemberDoc = memberSnap.docs[0];
          console.log(`   ✅ Matched by memberId (${order.externalId.trim()})`);
        }
      }

      // 2. By email
      if (!targetMemberDoc && order.email) {
        memberSnap = await db.collection('members').where('emails', 'array-contains', order.email.trim()).limit(1).get();
        if (!memberSnap.empty) {
          targetMemberDoc = memberSnap.docs[0];
          console.log(`   ✅ Matched by email (${order.email.trim()})`);
        }
      }

      // 3. By name
      if (!targetMemberDoc && order.firstName && order.lastName) {
        const fullName = `${order.firstName.trim()} ${order.lastName.trim()}`;
        memberSnap = await db.collection('members').where('name', '==', fullName).limit(1).get();
        if (!memberSnap.empty) {
          targetMemberDoc = memberSnap.docs[0];
          console.log(`   ✅ Matched by name (${fullName})`);
        }
      }

      if (targetMemberDoc) {
        const memberData = targetMemberDoc.data();
        const displayInfo = `[Doc: ${targetMemberDoc.id} | MemberId: ${memberData?.memberId || 'N/A'} | Name: ${memberData?.name || 'Unknown'}]`;
        if (memberData?.membershipType === MembershipType.Life) {
          console.log(`   ℹ️  Member ${displayInfo} is already Life.`);
        } else {
          console.log(`   🚀 Updating member ${displayInfo} (Current: ${memberData?.membershipType}) to Life`);
          if (!isDryRun) {
            await db.collection('members').doc(targetMemberDoc.id).update({
              membershipType: MembershipType.Life,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`   📝 Success!`);
          } else {
            console.log(`   [DRY RUN] Would write to members/${targetMemberDoc.id}`);
          }
          updatedCount++;
        }
      } else {
        console.log(`   ❌ Could not find member for order! (memberId: ${order.externalId}, email: ${order.email}, name: ${order.firstName} ${order.lastName})`);
        notFoundCount++;
      }
    }
  }

  console.log(`\n=====================================================`);
  console.log(`Summary:`);
  console.log(`  Life Orders Found:    ${processedCount}`);
  console.log(`  Members Updated:      ${updatedCount}`);
  console.log(`  Members Not Found:    ${notFoundCount}`);
  if (isDryRun) {
    console.log(`  *** DRY RUN COMPLETED (No data was modified) ***`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('\n❌ Error:', e);
    process.exit(1);
  });
