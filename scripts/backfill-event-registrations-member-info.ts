/* backfill-event-registrations-member-info.ts
 *
 * Inspects and backfills `memberId`, `studentLevel`, and `applicationLevel`
 * on EventRegistration documents (`events/{eventId}/registrations/{regId}`)
 * and member mirror registrations (`members/{memberDocId}/events/{eventId}`).
 *
 * Usage:
 *   # Dry run (inspect only, no writes):
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/backfill-event-registrations-member-info.ts
 *
 *   # Commit changes:
 *   pnpm --prefix functions exec ts-node -O '{"module":"commonjs"}' ../scripts/backfill-event-registrations-member-info.ts --commit
 */

import * as admin from 'firebase-admin';

const COMMIT = process.argv.includes('--commit');
const DEFAULT_PROJECT = 'ilc-paris-class-tracker';
const projectArg = process.argv.find((a) => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : DEFAULT_PROJECT;

async function main() {
  console.log(`Using project: ${PROJECT_ID}`);
  console.log(`MODE: ${COMMIT ? 'COMMIT (writing changes)' : 'DRY RUN (no writes)'}`);

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  // 1. Load all members into a quick lookup map (docId -> Member, email -> Member)
  console.log('Loading members...');
  const membersSnap = await db.collection('members').get();
  console.log(`Loaded ${membersSnap.size} members.`);

  const memberByDocId = new Map<string, any>();
  const memberByMemberId = new Map<string, any>();
  const memberByEmail = new Map<string, any>();

  membersSnap.forEach((doc) => {
    const m: any = doc.data();
    m.docId = doc.id;
    memberByDocId.set(doc.id, m);
    if (m.memberId) {
      memberByMemberId.set(m.memberId.toLowerCase().trim(), m);
    }
    if (Array.isArray(m.emails)) {
      for (const e of m.emails) {
        if (e && typeof e === 'string') {
          memberByEmail.set(e.toLowerCase().trim(), m);
        }
      }
    }
  });

  // 2. Scan all events and their registrations subcollections
  console.log('Loading events...');
  const eventsSnap = await db.collection('events').get();
  console.log(`Loaded ${eventsSnap.size} events.`);

  let totalRegistrations = 0;
  let alreadyComplete = 0;
  let needsUpdate = 0;
  let unmatchable = 0;

  for (const eventDoc of eventsSnap.docs) {
    const eventId = eventDoc.id;
    const eventData: any = eventDoc.data();
    const eventTitle = eventData.title || 'Untitled';
    const regsSnap = await db.collection('events').doc(eventId).collection('registrations').get();
    if (regsSnap.empty) continue;

    for (const regDoc of regsSnap.docs) {
      totalRegistrations++;
      const reg: any = regDoc.data();
      const regEmail = (reg.email || '').toLowerCase().trim();

      // Find matching member
      let matchedMember: any = null;
      if (reg.memberDocId && memberByDocId.has(reg.memberDocId)) {
        matchedMember = memberByDocId.get(reg.memberDocId);
      } else if (reg.memberId && memberByMemberId.has(reg.memberId.toLowerCase().trim())) {
        matchedMember = memberByMemberId.get(reg.memberId.toLowerCase().trim());
      } else if (regEmail && memberByEmail.has(regEmail)) {
        matchedMember = memberByEmail.get(regEmail);
      }

      const currentMemberId = reg.memberId || '';
      const currentStudentLevel = reg.studentLevel || '';
      const currentAppLevel = reg.applicationLevel || '';

      const targetMemberId = matchedMember?.memberId || currentMemberId;
      const targetStudentLevel = currentStudentLevel || matchedMember?.studentLevel || '';
      const targetAppLevel = currentAppLevel || matchedMember?.applicationLevel || '';
      const targetMemberDocId = reg.memberDocId || matchedMember?.docId || '';

      const needsMemberIdUpdate = !currentMemberId && targetMemberId;
      const needsStudentLevelUpdate = !currentStudentLevel && targetStudentLevel;
      const needsAppLevelUpdate = !currentAppLevel && targetAppLevel;
      const needsMemberDocIdUpdate = !reg.memberDocId && targetMemberDocId;

      if (needsMemberIdUpdate || needsStudentLevelUpdate || needsAppLevelUpdate || needsMemberDocIdUpdate) {
        needsUpdate++;
        console.log(`\nEvent [${eventId}] "${eventTitle}" - Reg [${regDoc.id}] "${reg.name}" (${reg.email}):`);
        console.log(`  Current memberId: "${currentMemberId}", Matched memberId: "${matchedMember?.memberId}"`);
        if (needsMemberIdUpdate) console.log(`  + memberId: "${targetMemberId}"`);
        if (needsStudentLevelUpdate) console.log(`  + studentLevel: "${targetStudentLevel}"`);
        if (needsAppLevelUpdate) console.log(`  + applicationLevel: "${targetAppLevel}"`);
        if (needsMemberDocIdUpdate) console.log(`  + memberDocId: "${targetMemberDocId}"`);

        if (COMMIT) {
          const updates: any = {
            lastUpdated: new Date().toISOString(),
          };
          if (needsMemberIdUpdate) updates.memberId = targetMemberId;
          if (needsStudentLevelUpdate) updates.studentLevel = targetStudentLevel;
          if (needsAppLevelUpdate) updates.applicationLevel = targetAppLevel;
          if (needsMemberDocIdUpdate) updates.memberDocId = targetMemberDocId;

          await regDoc.ref.update(updates);

          if (targetMemberDocId) {
            const mirrorRef = db
              .collection('members')
              .doc(targetMemberDocId)
              .collection('events')
              .doc(eventId);
            const mirrorSnap = await mirrorRef.get();
            if (mirrorSnap.exists) {
              await mirrorRef.update(updates);
            }
          }
        }
      } else if (!matchedMember) {
        unmatchable++;
      } else {
        alreadyComplete++;
      }
    }
  }

  console.log('\n----------------------------------------');
  console.log(`Summary:`);
  console.log(`Total registrations scanned: ${totalRegistrations}`);
  console.log(`Already complete:            ${alreadyComplete}`);
  console.log(`Needs update (matched):      ${needsUpdate}`);
  console.log(`Unmatched (non-members):     ${unmatchable}`);
  console.log(`----------------------------------------`);
  if (!COMMIT && needsUpdate > 0) {
    console.log(`\nDry run complete. Re-run with --commit to apply updates.`);
  }
}

main().catch(console.error);
