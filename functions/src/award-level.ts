/* award-level.ts
 *
 * Awards the level a passed grading represents to the student's member record.
 * Used by the grading trigger and the admin actions library, so both behave
 * the same.
 *
 * The update runs in a Firestore transaction and only ever RAISES a level:
 * two gradings passed at nearly the same time (e.g. Student 2 and Student 3 at
 * one event) trigger two concurrent awards, and whichever lands last must not
 * pull the member back down. The transaction re-reads the member and writes
 * only when the awarded level is higher than what is stored.
 */

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  GradingLevel,
  LevelTrack,
  applicationLevelOf,
  applicationLevelRank,
  studentLevelOf,
  studentLevelRank,
  trackOf,
} from './data-model/curriculum';
import { Member, MemberUpdates } from './data-model/members';

/** What `awardGradingLevel` did. */
export enum AwardOutcome {
  // The member's level was raised to the awarded level.
  Raised = 'raised',
  // The member already held this level or higher; nothing was written.
  AlreadyHeld = 'already-held',
  // There is no member document to update.
  MemberNotFound = 'member-not-found',
}

// Raises the member's level on `level`'s track to `level`, unless they already
// hold it or higher. Safe to call concurrently and repeatedly.
export async function awardGradingLevel(
  db: admin.firestore.Firestore,
  memberRef: admin.firestore.DocumentReference,
  level: GradingLevel,
): Promise<AwardOutcome> {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    if (!snap.exists) return AwardOutcome.MemberNotFound;
    const member = snap.data() as Member;
    const update: MemberUpdates = { lastUpdated: FieldValue.serverTimestamp() };
    if (trackOf(level) === LevelTrack.Student) {
      const awarded = studentLevelOf(level);
      if (studentLevelRank(awarded) <= studentLevelRank(member.studentLevel)) {
        return AwardOutcome.AlreadyHeld;
      }
      update.studentLevel = awarded;
    } else {
      const awarded = applicationLevelOf(level);
      if (applicationLevelRank(awarded) <= applicationLevelRank(member.applicationLevel)) {
        return AwardOutcome.AlreadyHeld;
      }
      update.applicationLevel = awarded;
    }
    tx.update(memberRef, update);
    return AwardOutcome.Raised;
  });
}
