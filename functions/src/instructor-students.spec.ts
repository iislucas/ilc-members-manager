/* instructor-students.spec.ts — tests for the "instructor removes a student"
 * permission guard and the message the removed student is sent. */
import { describe, it, expect } from 'vitest';
import { findRemovingInstructor, removedStudentMarkdown } from './instructor-students';
import { Member, NotificationKind, notificationStyle } from './data-model';

const member = (overrides: Partial<Member>): Member =>
  ({ docId: 'doc', name: '', memberId: '', instructorId: '', primaryInstructorId: '', ...overrides }) as Member;

describe('findRemovingInstructor', () => {
  const sifu = member({ docId: 'sifu-doc', name: 'Sifu Sam', instructorId: 'INST-1' });
  const student = member({ docId: 'student-doc', memberId: 'FR23', primaryInstructorId: 'INST-1' });

  it('finds the caller profile whose instructorId is the student’s primary instructor', () => {
    expect(findRemovingInstructor([sifu], student)).toBe(sifu);
  });

  it('picks the matching profile when the caller manages several', () => {
    const otherProfile = member({ docId: 'other-doc', instructorId: 'INST-9' });
    expect(findRemovingInstructor([otherProfile, sifu], student)).toBe(sifu);
  });

  it('rejects an instructor who is not the student’s primary instructor', () => {
    const otherSifu = member({ docId: 'other-doc', instructorId: 'INST-2' });
    expect(findRemovingInstructor([otherSifu], student)).toBeUndefined();
  });

  it('rejects a caller with no instructor ID', () => {
    const nonInstructor = member({ docId: 'plain-doc', instructorId: '' });
    expect(findRemovingInstructor([nonInstructor], student)).toBeUndefined();
  });

  it('rejects when the student has no primary instructor, even for a caller with no instructorId', () => {
    const unattached = member({ docId: 'student-doc', primaryInstructorId: '' });
    const nonInstructor = member({ docId: 'plain-doc', instructorId: '' });
    expect(findRemovingInstructor([nonInstructor], unattached)).toBeUndefined();
    expect(findRemovingInstructor([sifu], unattached)).toBeUndefined();
  });

  it('rejects when the caller manages no member profiles', () => {
    expect(findRemovingInstructor([], student)).toBeUndefined();
  });
});

describe('removedStudentMarkdown', () => {
  const sifu = member({ name: 'Sifu Sam', instructorId: 'INST-1' });

  it('names the instructor, links to the profile page, and invites a conversation', () => {
    const md = removedStudentMarkdown(sifu);
    expect(md).toContain('Sifu Sam');
    expect(md).toContain('INST-1');
    expect(md).toContain('](/myProfile)');
    expect(md).toContain('talk to them directly');
  });

  // Choosing a new primary instructor is optional, so this is something to
  // know rather than a TODO — it must not render with the 'action' styling.
  it('is an informational notification, not an action', () => {
    expect(notificationStyle(NotificationKind.PrimaryInstructorRemoved)).toBe('info');
  });
});
