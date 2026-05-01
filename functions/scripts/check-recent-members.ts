/*
 * Check Recent Members Script
 *
 * Queries members updated in the last N days and checks whether their
 * memberIds are unique and correctly formatted.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/check-recent-members.ts [--days 60] [--project <PROJECT_ID>]
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Member } from '../src/data-model';

const argv = yargs(hideBin(process.argv))
  .option('project', {
    type: 'string',
    description: 'Firebase Project ID',
  })
  .option('days', {
    type: 'number',
    default: 60,
    describe: 'How many days back to look',
  })
  .parseSync();

const projectId =
  argv.project ||
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

async function main() {
  const days = argv.days;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  console.log(`\n🔍 Checking members updated in the last ${days} days`);
  console.log(`   (since ${cutoff.toISOString().split('T')[0]})`);
  console.log(`   Project: ${projectId}\n`);

  // 1. Get all members (we need the full set to check uniqueness)
  const allSnap = await db.collection('members').get();
  console.log(`📋 Total members in database: ${allSnap.size}`);

  // Build a map of memberId → list of docIds to detect duplicates
  const memberIdToDocIds = new Map<string, string[]>();
  const allMembers = new Map<string, Member>();

  for (const doc of allSnap.docs) {
    const data = doc.data();
    const member = data as Member;
    member.docId = doc.id;
    // Convert Timestamp to ISO string for consistent handling
    if (data.lastUpdated && typeof data.lastUpdated.toDate === 'function') {
      member.lastUpdated = data.lastUpdated.toDate().toISOString();
    } else if (data.lastUpdated) {
      member.lastUpdated = String(data.lastUpdated);
    }
    allMembers.set(doc.id, member);

    if (member.memberId) {
      const existing = memberIdToDocIds.get(member.memberId) || [];
      existing.push(doc.id);
      memberIdToDocIds.set(member.memberId, existing);
    }
  }

  // 2. Filter to recent members
  const recentMembers: Member[] = [];
  for (const member of allMembers.values()) {
    if (member.lastUpdated && member.lastUpdated >= cutoffStr) {
      recentMembers.push(member);
    }
  }

  // Sort by lastUpdated descending
  recentMembers.sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));

  console.log(`📋 Members updated in last ${days} days: ${recentMembers.length}\n`);

  // 3. Analyze each recent member
  const issues: string[] = [];
  const memberIdPattern = /^([A-Za-z]{2,3})(\d+)$/;
  let okCount = 0;

  console.log('─'.repeat(90));
  console.log(
    'Updated'.padEnd(12) +
    'MemberID'.padEnd(12) +
    'Name'.padEnd(30) +
    'InstrID'.padEnd(10) +
    'Status',
  );
  console.log('─'.repeat(90));

  for (const member of recentMembers) {
    const updated = (member.lastUpdated || '').split('T')[0];
    const name = (member.name || '(no name)').substring(0, 28);
    const mid = member.memberId || '(none)';
    const instrId = member.instructorId || '';
    const statusParts: string[] = [];

    // Check memberId format (missing memberIds are normal)
    if (member.memberId) {
      const match = member.memberId.match(memberIdPattern);
      if (!match) {
        statusParts.push(`⚠️  Non-standard format`);
      }
    }

    // Check for duplicate memberIds
    if (member.memberId) {
      const owners = memberIdToDocIds.get(member.memberId) || [];
      if (owners.length > 1) {
        statusParts.push(`❌ DUPLICATE memberId (${owners.length} members share it)`);
        issues.push(
          `Duplicate memberId "${member.memberId}": docIds = ${owners.join(', ')}`,
        );
      }
    }

    const status = statusParts.length > 0 ? statusParts.join('; ') : '✅';
    if (statusParts.length === 0) okCount++;

    console.log(
      updated.padEnd(12) +
      mid.padEnd(12) +
      name.padEnd(30) +
      instrId.padEnd(10) +
      status,
    );
  }

  console.log('─'.repeat(90));

  // 4. Global duplicate check (across ALL members, not just recent)
  const allDuplicates: string[] = [];
  for (const [mid, docIds] of memberIdToDocIds.entries()) {
    if (docIds.length > 1) {
      allDuplicates.push(
        `  "${mid}" shared by ${docIds.length} docs: ${docIds.join(', ')}`,
      );
    }
  }

  if (allDuplicates.length > 0) {
    console.log(`\n❌ ${allDuplicates.length} duplicate memberId(s) across ALL members:`);
    for (const dup of allDuplicates) {
      console.log(dup);
    }
  }

  // 5. Summary
  console.log('\n' + '='.repeat(60));
  console.log(`Recent members checked: ${recentMembers.length}`);
  console.log(`  ✅ OK: ${okCount}`);
  console.log(`  ⚠️  Issues: ${recentMembers.length - okCount}`);
  if (allDuplicates.length > 0) {
    console.log(`  ❌ Global duplicate memberIds: ${allDuplicates.length}`);
  } else {
    console.log(`  ✅ No duplicate memberIds in entire database`);
  }
  console.log('='.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
