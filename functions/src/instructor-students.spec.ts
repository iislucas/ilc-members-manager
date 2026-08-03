/* instructor-students.spec.ts — tests for the permission guards behind the
 * actions an instructor can take on their own student (removing them, and
 * recording a lapsed membership as inactive), and the messages the student is
 * sent for each. */
import { describe, it, expect } from 'vitest';
import {
  findPrimaryInstructorProfile,
  markedInactiveMarkdown,
  markInactiveRefusal,
  removedStudentMarkdown,
} from './instructor-students';
import {
  canMarkMembershipInactive,
  Member,
  MembershipType,
  NotificationKind,
  notificationStyle,
} from './data-model';

const member = (overrides: Partial<Member>): Member =>
  ({ docId: 'doc', name: '', memberId: '', instructorId: '', primaryInstructorId: '', ...overrides }) as Member;

describe('findPrimaryInstructorProfile', () => {
  const sifu = member({ docId: 'sifu-doc', name: 'Sifu Sam', instructorId: 'INST-1' });
  const student = member({ docId: 'student-doc', memberId: 'FR23', primaryInstructorId: 'INST-1' });

  it('finds the caller profile whose instructorId is the student’s primary instructor', () => {
    expect(findPrimaryInstructorProfile([sifu], student)).toBe(sifu);
  });

  it('picks the matching profile when the caller manages several', () => {
    const otherProfile = member({ docId: 'other-doc', instructorId: 'INST-9' });
    expect(findPrimaryInstructorProfile([otherProfile, sifu], student)).toBe(sifu);
  });

  it('rejects an instructor who is not the student’s primary instructor', () => {
    const otherSifu = member({ docId: 'other-doc', instructorId: 'INST-2' });
    expect(findPrimaryInstructorProfile([otherSifu], student)).toBeUndefined();
  });

  it('rejects a caller with no instructor ID', () => {
    const nonInstructor = member({ docId: 'plain-doc', instructorId: '' });
    expect(findPrimaryInstructorProfile([nonInstructor], student)).toBeUndefined();
  });

  it('rejects when the student has no primary instructor, even for a caller with no instructorId', () => {
    const unattached = member({ docId: 'student-doc', primaryInstructorId: '' });
    const nonInstructor = member({ docId: 'plain-doc', instructorId: '' });
    expect(findPrimaryInstructorProfile([nonInstructor], unattached)).toBeUndefined();
    expect(findPrimaryInstructorProfile([sifu], unattached)).toBeUndefined();
  });

  it('rejects when the caller manages no member profiles', () => {
    expect(findPrimaryInstructorProfile([], student)).toBeUndefined();
  });
});

describe('removedStudentMarkdown', () => {
  const sifu = member({ name: 'Sifu Sam', instructorId: 'INST-1' });

  it('names the instructor, links to the profile page, and invites a conversation', () => {
    const md = removedStudentMarkdown(sifu);
    expect(md).toContain('Sifu Sam');
    expect(md).toContain('INST-1');
    expect(md).toContain('(#/myProfile)');
    expect(md).toContain('talk to them directly');
  });

  // Choosing a new primary instructor is optional, so this is something to
  // know rather than a TODO — it must not render with the 'action' styling.
  it('is an informational notification, not an action', () => {
    expect(notificationStyle(NotificationKind.PrimaryInstructorRemoved)).toBe('info');
  });
});

describe('markedInactiveMarkdown', () => {
  const sifu = member({ name: 'Sifu Sam', instructorId: 'INST-1' });

  it('names the instructor, links to renewal, and invites a conversation', () => {
    const md = markedInactiveMarkdown(sifu);
    expect(md).toContain('Sifu Sam');
    expect(md).toContain('INST-1');
    // A path link, so the app's in-page link handler routes it (a '#/…' link
    // is deliberately left alone by that handler and would go nowhere).
    expect(md).toContain('](/products)');
    expect(md).toContain('talk to');
  });

  // The student keeps their instructor and their records; only the membership
  // status changes. Saying so avoids reading this as a removal.
  it('says the instructor relationship is unchanged', () => {
    expect(markedInactiveMarkdown(sifu)).toContain('still your primary instructor');
  });

  // Renewing is optional, so this is something to know rather than a TODO.
  it('is an informational notification, not an action', () => {
    expect(notificationStyle(NotificationKind.MembershipMarkedInactive)).toBe('info');
  });
});

// The guard the markStudentInactive callable applies on top of the primary
// instructor check: only a membership that has actually lapsed can be recorded
// as inactive.
describe('canMarkMembershipInactive', () => {
  const today = '2026-08-03';
  const membership = (
    membershipType: MembershipType,
    currentMembershipExpires = '',
  ) => ({ membershipType, currentMembershipExpires });

  it('allows an Annual membership that has expired', () => {
    expect(
      canMarkMembershipInactive(membership(MembershipType.Annual, '2026-08-02'), today),
    ).toBe(true);
  });

  it('allows an Annual membership with no expiry date recorded', () => {
    expect(canMarkMembershipInactive(membership(MembershipType.Annual), today)).toBe(true);
  });

  it('allows a student who never became a member', () => {
    expect(
      canMarkMembershipInactive(membership(MembershipType.NotYetAMember), today),
    ).toBe(true);
  });

  it('refuses an Annual membership that is still current', () => {
    expect(
      canMarkMembershipInactive(membership(MembershipType.Annual, '2026-12-31'), today),
    ).toBe(false);
  });

  // Expiry is inclusive: a membership is still current on the day it expires.
  it('refuses an Annual membership expiring today', () => {
    expect(
      canMarkMembershipInactive(membership(MembershipType.Annual, today), today),
    ).toBe(false);
  });

  it('refuses a Life membership, which never lapses', () => {
    expect(canMarkMembershipInactive(membership(MembershipType.Life), today)).toBe(false);
  });

  it('refuses members already recorded as Inactive or Deceased', () => {
    expect(canMarkMembershipInactive(membership(MembershipType.Inactive), today)).toBe(false);
    expect(canMarkMembershipInactive(membership(MembershipType.Deceased), today)).toBe(false);
  });
});

// The instructor only sees these when their copy of the member was stale, so
// each refusal has to explain which case it hit rather than blaming the date.
describe('markInactiveRefusal', () => {
  it('distinguishes already-inactive, deceased, and still-current', () => {
    expect(markInactiveRefusal(MembershipType.Inactive)).toContain('already marked inactive');
    expect(markInactiveRefusal(MembershipType.Deceased)).toContain('deceased');
    expect(markInactiveRefusal(MembershipType.Annual)).toContain('still current');
  });
});
