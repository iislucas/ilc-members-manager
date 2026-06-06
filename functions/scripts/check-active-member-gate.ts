/*
 * Active-member gate check (READ-ONLY).
 *
 * BlogPost notifications are only created (client-side) for members the app
 * considers "active" via isActiveMember() / isActiveInstructor(). This script
 * reproduces those exact predicates against every member and reports how many
 * pass, and why members fail — to see whether a missing/empty field
 * (e.g. currentMembershipExpires, membershipType) is silently excluding people.
 * Writes nothing.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/check-active-member-gate.ts [--project <PROJECT_ID>]
 */
import * as admin from 'firebase-admin';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Member, MembershipType, ExpiryStatus } from '../src/data-model';
import { getInstructorExpiryStatus } from '../../src/app/member-tags';

const argv = yargs(hideBin(process.argv)).option('project', { type: 'string' }).parseSync();
const projectId =
  argv.project || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;

admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

// Mirrors NotificationService.isActiveMember
function isActiveMember(m: Member): boolean {
  if (m.membershipType === MembershipType.Life) return true;
  if (m.membershipType === MembershipType.Inactive || m.membershipType === MembershipType.Deceased)
    return false;
  if (!m.currentMembershipExpires) return false;
  return new Date(m.currentMembershipExpires) > new Date();
}

// Mirrors NotificationService.isActiveInstructor
function isActiveInstructor(m: Member): boolean {
  if (!m.instructorId) return false;
  const today = new Date().toISOString().split('T')[0];
  return getInstructorExpiryStatus(m, today) === ExpiryStatus.Valid;
}

async function main() {
  console.log(`\n🔍 Active-member gate — project: ${projectId}\n`);
  const snap = await db.collection('members').get();

  let activeMembers = 0;
  let activeInstructors = 0;
  let eligibleForAnyBlog = 0;

  const byMembershipType = new Map<string, number>();
  let missingMembershipType = 0;
  let missingExpiry = 0;
  let expiredExpiry = 0;
  let futureExpiry = 0;

  for (const doc of snap.docs) {
    const m = doc.data() as Member;
    m.docId = doc.id;

    const mt = (m.membershipType as string) || '(unset)';
    byMembershipType.set(mt, (byMembershipType.get(mt) || 0) + 1);
    if (!m.membershipType) missingMembershipType++;

    if (!m.currentMembershipExpires) {
      missingExpiry++;
    } else if (new Date(m.currentMembershipExpires) > new Date()) {
      futureExpiry++;
    } else {
      expiredExpiry++;
    }

    const am = isActiveMember(m);
    const ai = isActiveInstructor(m);
    if (am) activeMembers++;
    if (ai) activeInstructors++;
    if (am || ai) eligibleForAnyBlog++;
  }

  console.log(`Total members: ${snap.size}\n`);

  console.log('membershipType distribution:');
  for (const [mt, c] of [...byMembershipType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${mt.padEnd(20)} ${c}`);
  }

  console.log('\ncurrentMembershipExpires:');
  console.log(`  missing/empty: ${missingExpiry}`);
  console.log(`  in the future: ${futureExpiry}`);
  console.log(`  in the past:   ${expiredExpiry}`);
  console.log(`  (missing membershipType entirely: ${missingMembershipType})`);

  console.log('\nBlogPost notification eligibility (client gate):');
  console.log(`  isActiveMember()     => ${activeMembers}`);
  console.log(`  isActiveInstructor() => ${activeInstructors}`);
  console.log(`  eligible for ANY blog feed => ${eligibleForAnyBlog} of ${snap.size}`);
  console.log('\n(These are the only members who will ever have BlogPost');
  console.log(' notifications generated when they open the app.)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Script failed:', err);
    process.exit(1);
  });
