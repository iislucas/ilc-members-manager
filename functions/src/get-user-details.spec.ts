/* get-user-details.spec.ts
 *
 * Pins down the post-sign-in profile lookup, and in particular that a verified
 * user is never handed an empty profile list (which the client can only answer
 * with "We could not find your profile" and a forced sign-out).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { CallableRequest } from 'firebase-functions/v2/https';
import { InMemoryFirestore } from './testing/in-memory-firestore';
import { MembershipType } from './data-model/members';

vi.mock('./on-member-update', () => ({
  refreshACLAdminStatus: vi.fn().mockResolvedValue(undefined),
}));

import { getUserDetailsHelper } from './get-user-details';
import { refreshACLAdminStatus } from './on-member-update';

const EMAIL = 'jane@example.com';

function request(): CallableRequest<unknown> {
  return { auth: { uid: 'uid-1' }, data: undefined } as unknown as CallableRequest<unknown>;
}

function useDb(fake: InMemoryFirestore): void {
  vi.spyOn(admin, 'firestore').mockReturnValue(fake.asFirestore());
  // The spy replaces the namespace function, so restore the static the
  // guest-profile path uses.
  Object.assign(admin.firestore, {
    FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
  });
}

function useAuthUser(user: { email?: string; emailVerified: boolean }): void {
  vi.spyOn(admin, 'auth').mockReturnValue({
    getUser: vi.fn().mockResolvedValue(user),
  } as unknown as admin.auth.Auth);
}

describe('getUserDetailsHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthUser({ email: EMAIL, emailVerified: true });
  });

  it('returns the profiles listed in the ACL', async () => {
    const fake = new InMemoryFirestore({
      acl: { [EMAIL]: { memberDocIds: ['m1'], isAdmin: false, schoolDocIds: ['s1'] } },
      members: { m1: { emails: [EMAIL], memberId: 'US1', name: 'Jane' } },
    });
    useDb(fake);

    const result = await getUserDetailsHelper(request());

    expect(result.userMemberProfiles.map((m) => m.docId)).toEqual(['m1']);
    expect(result.schoolsManaged).toEqual(['s1']);
    expect(result.isAdmin).toBe(false);
    expect(refreshACLAdminStatus).not.toHaveBeenCalled();
  });

  it('creates a guest profile when the ACL lists only deleted members', async () => {
    const fake = new InMemoryFirestore({
      acl: { [EMAIL]: { memberDocIds: ['deleted'], isAdmin: false } },
    });
    useDb(fake);

    const result = await getUserDetailsHelper(request());

    expect(result.userMemberProfiles).toHaveLength(1);
    const guest = result.userMemberProfiles[0];
    expect(guest.membershipType).toBe(MembershipType.NotYetAMember);
    expect(guest.emails).toEqual([EMAIL]);
    expect(fake.data('members', guest.docId)).toBeDefined();
    expect(fake.data('acl', EMAIL)).toMatchObject({
      memberDocIds: [guest.docId],
      notYetLinkedToMember: true,
    });
  });

  it('keeps an admin signed in when their ACL has no member profile', async () => {
    const fake = new InMemoryFirestore({
      acl: { [EMAIL]: { memberDocIds: [], isAdmin: true, notYetLinkedToMember: true } },
    });
    useDb(fake);

    const result = await getUserDetailsHelper(request());

    expect(result.userMemberProfiles).toHaveLength(1);
    expect(result.isAdmin).toBe(true);
    // Admin rights are preserved on the ACL, not reset by the guest path.
    expect(fake.data('acl', EMAIL)).toMatchObject({ isAdmin: true });
  });

  it('creates a guest profile and ACL for an unknown email', async () => {
    const fake = new InMemoryFirestore();
    useDb(fake);

    const result = await getUserDetailsHelper(request());

    expect(result.userMemberProfiles).toHaveLength(1);
    expect(result.isAdmin).toBe(false);
    expect(fake.data('acl', EMAIL)).toMatchObject({
      memberDocIds: [result.userMemberProfiles[0].docId],
      isAdmin: false,
      notYetLinkedToMember: true,
    });
  });

  it('repairs a missing ACL from members that list the email', async () => {
    const fake = new InMemoryFirestore({
      members: { m1: { emails: [EMAIL], memberId: 'US1' } },
    });
    useDb(fake);

    const result = await getUserDetailsHelper(request());

    expect(result.userMemberProfiles.map((m) => m.docId)).toEqual(['m1']);
    expect(fake.data('acl', EMAIL)).toMatchObject({ memberDocIds: ['m1'], isAdmin: false });
    expect(refreshACLAdminStatus).toHaveBeenCalledWith(EMAIL);
    expect(fake.ids('members')).toEqual(['m1']); // no guest created
  });

  it('repairs a stale ACL from members that list the email, keeping admin rights', async () => {
    const fake = new InMemoryFirestore({
      acl: { [EMAIL]: { memberDocIds: ['deleted'], isAdmin: true } },
      members: { m1: { emails: [EMAIL], memberId: 'US1' } },
    });
    useDb(fake);

    const result = await getUserDetailsHelper(request());

    expect(result.userMemberProfiles.map((m) => m.docId)).toEqual(['m1']);
    expect(result.isAdmin).toBe(true);
    expect(fake.data('acl', EMAIL)).toMatchObject({ memberDocIds: ['m1'], isAdmin: true });
    expect(fake.ids('members')).toEqual(['m1']);
  });

  it('returns no profiles and writes nothing for an unverified email', async () => {
    useAuthUser({ email: EMAIL, emailVerified: false });
    const fake = new InMemoryFirestore();
    useDb(fake);

    const result = await getUserDetailsHelper(request());

    expect(result.userMemberProfiles).toEqual([]);
    expect(fake.ids('members')).toEqual([]);
    expect(fake.ids('acl')).toEqual([]);
  });
});
