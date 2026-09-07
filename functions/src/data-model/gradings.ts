import { FsTimestamp, GenericFsDoc, normalizeLastUpdated } from './base';
import {
  gradingProgression,
  achievedGradingLevels,
  normalizeGradingLevel,
} from './curriculum';

export enum GradingStatus {
  /** Flagged for admin review (e.g. mismatch in automated processing). */
  RequiresReview = 'in-review',
  /** Initial state when purchased, waiting for student to select an instructor. */
  AwaitingRequest = 'pending',
  /** Student has requested grading, waiting for instructor to accept or decline. */
  AwaitingAcceptance = 'awaiting-instructor-acceptance',
  /** Instructor declined the request. Student should select a different instructor. */
  Declined = 'declined',
  /** Instructor has accepted, waiting for grading to happen and result to be recorded. */
  AwaitingGrading = 'awaiting-instructor-grading',
  /** Student passed the grading. */
  Passed = 'passed',
  /** Student did not pass the grading. */
  NotPassed = 'not-passed',
}

/** How a grading was paid for. A grading only updates the student's level once
 * it is paid (i.e. not `NotYetPaid`). */
export enum PaymentStatus {
  NotYetPaid = 'not-yet-paid',
  PaidBySquarespace = 'paid-by-squarespace',
  PaidByStripe = 'paid-by-stripe',
  PaidByCash = 'paid-by-cash',
  PaidOther = 'paid-other',
}

/** All payment statuses, for building selectors. */
export const PAYMENT_STATUSES = Object.values(PaymentStatus);

/** Human-readable labels for each payment status. */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  [PaymentStatus.NotYetPaid]: 'Not yet paid',
  [PaymentStatus.PaidBySquarespace]: 'Paid online (Squarespace)',
  [PaymentStatus.PaidByStripe]: 'Paid online (Stripe)',
  [PaymentStatus.PaidByCash]: 'Paid (cash)',
  [PaymentStatus.PaidOther]: 'Paid (other)',
};

// Whether a grading counts as paid. Anything other than NotYetPaid is paid;
// undefined (un-backfilled docs) is treated as paid. Reads tolerate the raw
// string so it works on docs not run through firestoreDocToGrading (e.g. inside
// Cloud Function triggers).
export function isGradingPaid(g: { paymentStatus?: PaymentStatus | string }): boolean {
  return (g.paymentStatus ?? '') !== PaymentStatus.NotYetPaid;
}

/** The minimum shape needed to decide whether a grading still owes its HQ fee. */
export type UnpaidGradingCandidate = {
  level: string;
  status: GradingStatus | string;
  paymentStatus?: PaymentStatus | string;
};

// The gradings a member still owes the HQ fee for, earliest in
// `gradingProgression` first. See `nextGradingPayment` for how a payment picks
// among them.
//
// `NotPassed` attempts are excluded: that level is governed by the free-retake
// flow, and a payment must never be swallowed by a closed, failed attempt.
// Levels missing from `gradingProgression` sort last.
export function unpaidGradingsInProgressionOrder<T extends UnpaidGradingCandidate>(
  gradings: T[],
): T[] {
  return gradings
    .filter(
      (g) =>
        !!g.level && !isGradingPaid(g) && g.status !== GradingStatus.NotPassed,
    )
    .sort((a, b) => {
      const idxA = gradingProgression.indexOf(normalizeGradingLevel(a.level));
      const idxB = gradingProgression.indexOf(normalizeGradingLevel(b.level));
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });
}

/** What a grading payment applies to: a level, and the unpaid grading record at
 * that level when one already exists (otherwise the record must be created). */
export type NextGradingPayment<T> = {
  /** The level being paid for. '' when the whole progression is complete. */
  level: string;
  /** The existing unpaid grading this payment settles, or null if none exists. */
  grading: T | null;
};

// The next grading a member owes a fee for, walking `gradingProgression` in
// order. This is the single rule behind both what the purchase page offers and
// what an incoming payment is applied to, so the level on the receipt and the
// grading that gets paid can never disagree.
//
// At each level, in order:
//   - an unpaid grading record means the fee is still owed → settle that record;
//   - an achieved level is done and paid for → keep walking;
//   - a paid, still-open grading has been bought already → keep walking, which
//     is what lets a student buy their following level in advance;
//   - `skipLevel` (a free retake the caller handles separately) → keep walking;
//   - otherwise this is the next level to buy, and no record exists for it yet.
//
// Returns `{ level: '', grading: null }` once every level has been achieved.
export function nextGradingPayment<T extends UnpaidGradingCandidate>(
  studentLevel: string,
  applicationLevel: string,
  gradings: T[],
  skipLevel = '',
): NextGradingPayment<T> {
  const achieved = achievedGradingLevels(studentLevel, applicationLevel);

  // Earliest-first, so a level with several unpaid records settles the oldest.
  const unpaidByLevel = new Map<string, T>();
  for (const g of unpaidGradingsInProgressionOrder(gradings)) {
    const lvl = normalizeGradingLevel(g.level);
    if (!unpaidByLevel.has(lvl)) unpaidByLevel.set(lvl, g);
  }

  const paidAndOpen = new Set(
    gradings
      .filter(
        (g) =>
          !!g.level &&
          isGradingPaid(g) &&
          g.status !== GradingStatus.Passed &&
          g.status !== GradingStatus.NotPassed,
      )
      .map((g) => normalizeGradingLevel(g.level)),
  );

  for (const level of gradingProgression) {
    const unpaid = unpaidByLevel.get(level);
    if (unpaid) return { level, grading: unpaid };
    if (achieved.has(level)) continue;
    if (paidAndOpen.has(level)) continue;
    if (level === skipLevel) continue;
    return { level, grading: null };
  }
  return { level: '', grading: null };
}

// 32-bit FNV-1a. Deterministic across node and the browser, and good enough to
// spread order references evenly over the four digits below.
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619, kept in 32-bit range without overflowing to a float.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

// An order's reference ("Order Ref #" in the UI): the date the order was placed,
// then four digits derived from the real order reference (the Stripe invoice or
// session id, or the Squarespace order number).
//
//   orderDisplayNumber('2026-08-13T05:35:27Z', 'cs_live_a1b2') → '20260813-4713'
//
// It is stable for a given order, short enough to read out loud, and carries no
// information about the underlying account. The four digits are not unique on
// their own; the date is what separates two orders that happen to collide.
//
// Returns '' when there is no source reference, i.e. nothing was purchased —
// for example a grading an admin created by hand.
export function orderDisplayNumber(orderDate: string, sourceRef: string): string {
  const ref = (sourceRef || '').trim();
  if (!ref) return '';
  const date = (orderDate || '').trim();
  const day = /^\d{4}-\d{2}-\d{2}/.test(date)
    ? date.substring(0, 10).replace(/-/g, '')
    : '00000000';
  const digits = String(fnv1aHash(ref) % 10000).padStart(4, '0');
  return `${day}-${digits}`;
}

/** The minimum shape needed to derive a grading's reference. */
export type GradingIdCandidate = {
  docId: string;
  gradingEventDate?: string;
};

// A grading's reference ("Ref #" in the UI): the year and month the grading
// takes place, then the last four characters of its document id.
//
//   gradingDisplayId({ docId: 'k3Bq7ZmA5b1', gradingEventDate: '2026-08-13' })
//     → '202608-A5b1'
//
// It needs no order, so a grading paid for in cash — or created by an admin —
// has a reference like any other. The last four characters are lifted straight
// from the document id, so an admin can find the grading from a reference a
// student quotes. They are not unique on their own; the year and month are what
// separate two gradings whose ids end the same way.
//
// Returns '' until the grading event date is set, since the date is half the
// reference. A grading cannot be marked passed or not-passed without that date
// (see `onGradingUpdated`), so every finished grading has a reference.
export function gradingDisplayId(grading: GradingIdCandidate): string {
  const docId = (grading.docId || '').trim();
  const date = (grading.gradingEventDate || '').trim();
  if (!docId || !/^\d{4}-\d{2}/.test(date)) return '';
  return `${date.substring(0, 7).replace('-', '')}-${docId.slice(-4)}`;
}

export function getPrettyGradingStatus(status: GradingStatus): string {
  switch (status) {
    case GradingStatus.AwaitingRequest:
      return '(1) Awaiting instructor selection';
    case GradingStatus.AwaitingAcceptance:
      return '(2) Awaiting instructor acceptance';
    case GradingStatus.AwaitingGrading:
      return '(3) Awaiting grading & instructor notes';
    case GradingStatus.Declined:
      return '(1b) (Declined) Awaiting instructor re-selection';
    case GradingStatus.Passed:
      return '(4a) Passed';
    case GradingStatus.NotPassed:
      return '(4b) Not passed this time';
    case GradingStatus.RequiresReview:
      return '(0) Required admin review';
    default:
      return status;
  }
}

// Firestore path: /gradings/{doc-id}
export type Grading = {
  docId: string; // Firestore document ID, UNIQUE, auto-generated.
  lastUpdated: string; // ISO string: YYYY-MM-DD; Converted from server Timestamp.

  gradingPurchaseDate: string; // YYYY-MM-DD, the date the grading was purchased.
  orderId: string; // The order ID that created this grading, or '' if manual.
  level: string; // The level the grading is aimed for ('Student X' or 'Application X').
  gradingInstructorId: string; // The instructorId (human readable) of the grading instructor.
  // The instructorIds (human readable) of the grading managers. Grading managers
  // have the same edit permissions as the primary instructor (they can accept,
  // record results, and re-assign the primary instructor). In the UI this is
  // displayed as "Grading Managers".
  gradingManagerIds: string[];
  // How the grading was paid for. Order-created gradings are PaidBySquarespace; a
  // grading only updates the student's level once paid (anything but NotYetPaid).
  // Editable by grading managers/instructors/admins (not the student). Undefined
  // (un-backfilled docs) is treated as paid. See `isGradingPaid`.
  paymentStatus: PaymentStatus;
  // Free-form note about payment (e.g. who collected cash, reference). Visible to
  // managers/instructors/admins only.
  paymentNote: string;
  // Snapshot of the student's student/application levels at the moment the
  // grading was accepted (status → AwaitingGrading). Lets us show/validate the
  // level the student held going in without re-inferring it from `level`. '' when
  // not yet captured.
  studentLevelAtAcceptance: string;
  applicationLevelAtAcceptance: string;
  schoolId: string; // The human-readable schoolId where the grading was conducted. Optional.
  schoolDocId: string; // The Firestore doc ID of the school where the grading was conducted.
  studentMemberId: string; // The human-readable memberId of the student being graded.
  studentMemberDocId: string; // The Firestore doc ID of the student member document.
  // Denormalized display-name snapshots, kept in sync by the grading triggers
  // (see on-grading-update.ts) on every create/update. They let non-admin
  // viewers — who cannot read the members/instructors collections — see the
  // student and primary instructor names instead of bare IDs. Plain `name`
  // values; the UI still formats them with the IDs it already has on the
  // grading. '' until first resolved (e.g. the member doc isn't found).
  studentName: string; // Display name of the student at the last create/update.
  gradingInstructorName: string; // Display name of the primary grading instructor.
  status: GradingStatus; // See GradingStatus enum for details.
  gradingEventDate: string; // YYYY-MM-DD, set when grading is conducted.
  gradingEvent: string; // Text string for event/location/date of the grading.
  gradingEventDocId: string; // Firestore doc ID of the linked IlcEvent, or '' if not linked.
  notes: string; // Any notes about the grading.
  studentNotes: string; // Optional note from the student when requesting the grading.
  instructorAcceptedDate: string; // YYYY-MM-DD, date the instructor accepted.
  // Who accepted the grading request (a distinct milestone — the manager who
  // took it on). Set when the status moves to AwaitingGrading; cleared if it is
  // later declined. '' if never accepted. The name is a denormalized snapshot so
  // it displays without a member lookup.
  acceptedByMemberDocId: string; // Firestore doc ID of the accepting member.
  acceptedByName: string; // Display name of the accepting member at the time.
  // Who most recently changed the grading's status via the workflow (accept,
  // decline, revert, record result). Used to show "Declined by X" and to tell
  // co-managers who acted. Distinct from acceptedBy*: this tracks the latest
  // status transition regardless of kind. '' until the first status change.
  statusChangedByMemberDocId: string; // Firestore doc ID of the member who acted.
  statusChangedByName: string; // Display name of that member at the time.
  resultNotes: string; // Notes from the grading/assigned instructor to the student after grading.
  declineNotes: string; // Notes from the instructor explaining why they declined.
  reviewIssue: string; // Store the issue/reason when grading processing requires admin review.
};

export type GradingFsDoc = Omit<Grading, 'lastUpdated' | 'docId'> & {
  lastUpdated: FsTimestamp;
};

export function initGrading(): Grading {
  return {
    docId: '',
    lastUpdated: new Date().toISOString(),
    gradingPurchaseDate: '',
    orderId: '',
    level: '',
    gradingInstructorId: '',
    gradingManagerIds: [],
    paymentStatus: PaymentStatus.PaidOther,
    paymentNote: '',
    studentLevelAtAcceptance: '',
    applicationLevelAtAcceptance: '',
    schoolId: '',
    schoolDocId: '',
    studentMemberId: '',
    studentMemberDocId: '',
    studentName: '',
    gradingInstructorName: '',
    status: GradingStatus.AwaitingRequest,
    gradingEventDate: '',
    gradingEvent: '',
    gradingEventDocId: '',
    notes: '',
    studentNotes: '',
    instructorAcceptedDate: '',
    acceptedByMemberDocId: '',
    acceptedByName: '',
    statusChangedByMemberDocId: '',
    statusChangedByName: '',
    resultNotes: '',
    declineNotes: '',
    reviewIssue: '',
  };
}

export function firestoreDocToGrading(doc: GenericFsDoc): Grading {
  const docData = doc.data() as GradingFsDoc;
  const lastUpdated = normalizeLastUpdated(docData.lastUpdated);
  const grading = { ...initGrading(), ...docData, lastUpdated, docId: doc.id };
  if (grading.level) {
    const lower = grading.level.toLowerCase().trim();
    if (lower === 'entry level' || lower === 'entry') {
      grading.level = 'Student Entry';
    }
  }
  const rawData = docData as unknown as Partial<Grading>;
  grading.gradingManagerIds = rawData.gradingManagerIds ?? [];
  // Undefined `paymentStatus` (un-backfilled docs) is treated as paid (PaidOther).
  grading.paymentStatus = rawData.paymentStatus ?? PaymentStatus.PaidOther;
  return grading;
}

// Read a grading's grading-manager instructorIds. A thin accessor kept for call
// sites that work with raw/partial grading data and need the default-[] guard.
export function gradingManagerIdsOf(
  g: { gradingManagerIds?: string[] },
): string[] {
  return g.gradingManagerIds ?? [];
}
