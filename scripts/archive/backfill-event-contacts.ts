//**
 * @file scripts/archive/backfill-event-contacts.ts
 * @status ARCHIVED / MIGRATION COMPLETED
 * @pr PR #55 (feat(events): creator + a chosen subset of managers as public contacts)
 * @commit 2da5348
 * @date 2026-07-31
 *
 * Description:
 * One-off migration for the "creator + listed contacts" change to events.
 * An event's `ownerDocId` used to mean both "the creator" and "the public contact".
 * It was updated to mean only the creator, while public contacts moved to the `contacts`
 * array. This script added `ownerDocId` to `managerDocIds`, added the creator to `contacts`,
 * and mirrored the event into `members/{ownerDocId}/events/{eventId}`.
 */

import * as admin from 'firebase-admin';

// Kept dependency-free (like reconcile-event-mirrors.ts) so it runs under
// ts-node without the functions build; `creatorContact` below mirrors
// `contactFromCreator` / `eventOwnerContact` in functions/src/data-model.ts.
type EventContact = {
  memberDocId: string;
  name: string;
  memberId: string;
  instructorId: string;
  contactEmail: string;
  contactUrl: string;
};

const COMMIT = process.argv.includes('--commit');
const DEFAULT_PROJECT = 'ilc-paris-class-tracker';
const projectArg = process.argv.find((a) => a.startsWith('--project='));
const PROJECT_ID = projectArg ? projectArg.split('=')[1] : DEFAULT_PROJECT;

// Fields stripped from the per-member mirror copy (private; never shown there).
const PRIVATE_FIELDS = ['ownerEmails', 'managerEmails'] as const;

function mirrorData(canonical: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...canonical };
  for (const f of PRIVATE_FIELDS) delete copy[f];
  return copy;
}

// The contact entry for an event's creator: the cached owner* fields, topped up
// from their member document. Events created before those fields existed have
// none of them, and falling all the way back to an email would publish it as
// the contact's display name.
function creatorContact(
  event: Record<string, unknown>,
  member: Record<string, unknown> | undefined,
): EventContact {
  const str = (k: string) => (event[k] as string) || '';
  const memberStr = (k: string) => (member?.[k] as string) || '';
  const emails = (event['ownerEmails'] as string[]) || [];
  const memberId = str('ownerMemberId') || memberStr('memberId');
  return {
    memberDocId: str('ownerDocId'),
    name: str('ownerName') || memberStr('name') || memberId || emails[0] || '',
    memberId,
    instructorId: str('ownerInstructorId') || memberStr('instructorId'),
    contactEmail: str('ownerContactEmail'),
    contactUrl: str('ownerContactUrl'),
  };
}

async function main() {
  console.log(`Using project: ${PROJECT_ID}`);
  console.log(COMMIT ? 'MODE: COMMIT (writes enabled)' : 'MODE: DRY RUN (no writes)');
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();

  const eventsSnap = await db.collection('events').get();
  console.log(`Loaded ${eventsSnap.size} events.`);

  let managerAdds = 0;
  let contactAdds = 0;
  let mirrorAdds = 0;
  let unchanged = 0;

  for (const doc of eventsSnap.docs) {
    const event = doc.data() as Record<string, unknown>;
    const ownerDocId = (event['ownerDocId'] as string) || '';
    if (!ownerDocId) {
      unchanged++;
      continue;
    }

    const managerDocIds = (event['managerDocIds'] as string[]) || [];
    const contacts = (event['contacts'] as EventContact[]) || [];

    const needsManager = !managerDocIds.includes(ownerDocId);
    const needsContact = !contacts.some((c) => c && c.memberDocId === ownerDocId);
    if (!needsManager && !needsContact) {
      unchanged++;
      continue;
    }

    const update: Record<string, unknown> = {};
    if (needsManager) {
      update['managerDocIds'] = [...managerDocIds, ownerDocId];
      console.log(`ADD creator as manager: events/${doc.id} (${ownerDocId})`);
      managerAdds++;
    }
    if (needsContact) {
      // The onEventUpdated trigger refreshes the cached name/memberId/
      // instructorId from the member document after this write.
      const memberSnap = await db.collection('members').doc(ownerDocId).get();
      const creator = creatorContact(event, memberSnap.data());
      update['contacts'] = [...contacts, creator];
      console.log(`ADD creator as contact: events/${doc.id} (${creator.name || ownerDocId})`);
      contactAdds++;
    }

    if (COMMIT) await doc.ref.update(update);

    // A creator who was not already a manager may have no mirror copy.
    if (needsManager) {
      const mirrorRef = db.collection('members').doc(ownerDocId)
        .collection('events').doc(doc.id);
      const mirrorSnap = await mirrorRef.get();
      if (!mirrorSnap.exists) {
        console.log(`CREATE missing mirror: members/${ownerDocId}/events/${doc.id}`);
        if (COMMIT) await mirrorRef.set(mirrorData({ ...event, ...update }));
        mirrorAdds++;
      }
    }
  }

  console.log(`\nDone. ${managerAdds} manager add(s), ${contactAdds} contact add(s), ` +
    `${mirrorAdds} mirror create(s), ${unchanged} event(s) already correct.` +
    (COMMIT ? '' : ' (dry run — re-run with --commit to apply)'));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
