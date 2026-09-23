/* common.spec.ts — tests for shared membership helpers. */
import * as admin from 'firebase-admin';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hasActiveMembership,
  hasActiveInstructorLicense,
  assertAdmin,
  assertAdminOrSchoolManager,
} from './common';
import { Member, MembershipType } from './data-model/members';
import { InstructorLicenseType } from './data-model/curriculum';
import { HttpsError } from 'firebase-functions/v2/https';

describe('hasActiveMembership', () => {
  const today = new Date().toISOString().split('T')[0];
  const future = '2999-01-01';
  const past = '2000-01-01';

  it('is true for a Life member regardless of expiry', () => {
    const m = { membershipType: MembershipType.Life, currentMembershipExpires: '' } as Member;
    expect(hasActiveMembership(m)).toBe(true);
  });

  it('is true for an Annual member whose membership expires in the future', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: future } as Member;
    expect(hasActiveMembership(m)).toBe(true);
  });

  it('is true for an Annual member expiring today', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: today } as Member;
    expect(hasActiveMembership(m)).toBe(true);
  });

  it('is false for an Annual member whose membership has expired', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: past } as Member;
    expect(hasActiveMembership(m)).toBe(false);
  });

  it('is false for an Annual member with no expiry date', () => {
    const m = { membershipType: MembershipType.Annual, currentMembershipExpires: '' } as Member;
    expect(hasActiveMembership(m)).toBe(false);
  });

  it('is false for non-annual / non-life membership types', () => {
    for (const type of [MembershipType.Inactive, MembershipType.Deceased, MembershipType.NotYetAMember]) {
      const m = { membershipType: type, currentMembershipExpires: future } as Member;
      expect(hasActiveMembership(m)).toBe(false);
    }
  });
});

describe('hasActiveInstructorLicense', () => {
  const today = new Date().toISOString().split('T')[0];
  const future = '2999-01-01';
  const past = '2000-01-01';

  it('is false if member has no instructorId', () => {
    expect(hasActiveInstructorLicense({ instructorId: null, instructorLicenseExpires: future })).toBe(false);
    expect(hasActiveInstructorLicense({ instructorId: 0, instructorLicenseExpires: future })).toBe(false);
    expect(hasActiveInstructorLicense({ instructorId: undefined, instructorLicenseExpires: future })).toBe(false);
  });

  it('is true for Life license type regardless of expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseType: InstructorLicenseType.Life })).toBe(true);
  });

  it('is true for life sentinel string expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: 'life' })).toBe(true);
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: '9999-12-31' })).toBe(true);
  });

  it('is true for future license expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: future })).toBe(true);
  });

  it('is true for license expiring today', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: today })).toBe(true);
  });

  it('is false for expired license', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: past })).toBe(false);
  });

  it('is false for empty license expiry', () => {
    expect(hasActiveInstructorLicense({ instructorId: 10, instructorLicenseExpires: '' })).toBe(false);
  });
});

describe('assertAdmin and assertAdminOrSchoolManager', () => {
  let mockAcl: Record<string, unknown> | null = null;
  let mockMember: Record<string, unknown> | null = null;

  beforeEach(() => {
    mockAcl = null;
    mockMember = null;
    vi.spyOn(admin, 'firestore').mockReturnValue({
      collection: (col: string) => {
        if (col === 'acl') {
          return {
            doc: (_docId: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: mockAcl !== null,
                data: () => mockAcl,
              }),
            }),
          };
        }
        if (col === 'members') {
          return {
            doc: (_id: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: mockMember !== null,
                id: 'mem-1',
                data: () => mockMember,
              }),
            }),
            where: () => ({
              limit: () => ({
                get: vi.fn().mockResolvedValue({
                  empty: mockMember === null,
                  docs: mockMember !== null ? [{ id: 'mem-1', data: () => mockMember }] : [],
                }),
              }),
            }),
          };
        }
        return {} as any;
      },
    } as any);
  });

  const makeReq = (email?: string) =>
    ({
      auth: email ? { token: { email }, uid: 'user-1' } : undefined,
      data: {},
    }) as any;

  it('assertAdmin throws unauthenticated when unauthenticated', async () => {
    await expect(assertAdmin(makeReq())).rejects.toThrowError(HttpsError);
  });

  it('assertAdmin throws permission-denied when acl has isAdmin: false', async () => {
    mockAcl = { isAdmin: false, memberDocIds: ['mem-1'] };
    mockMember = { name: 'Regular User', emails: ['user@example.com'] };
    await expect(assertAdmin(makeReq('user@example.com'))).rejects.toThrowError(HttpsError);
  });

  it('assertAdmin succeeds when acl has isAdmin: true', async () => {
    mockAcl = { isAdmin: true, memberDocIds: ['mem-1'] };
    mockMember = { name: 'Admin User', emails: ['admin@example.com'], isAdmin: true };
    const res = await assertAdmin(makeReq('admin@example.com'));
    expect(res.isAdmin).toBe(true);
  });

  it('assertAdmin fails if admin has no member profile', async () => {
    mockAcl = { isAdmin: true, memberDocIds: [] };
    mockMember = null;
    await expect(assertAdmin(makeReq('admin@example.com'))).rejects.toThrowError(HttpsError);
  });

  it('assertAdminOrSchoolManager allows school manager when acl has schoolDocIds', async () => {
    mockAcl = { isAdmin: false, schoolDocIds: ['SCH-1'], memberDocIds: ['mem-1'] };
    mockMember = { name: 'School Manager', emails: ['manager@example.com'] };
    const res = await assertAdminOrSchoolManager(makeReq('manager@example.com'));
    expect(res).toBeDefined();
  });

  it('assertAdminOrSchoolManager rejects non-admin non-school-manager', async () => {
    mockAcl = { isAdmin: false, schoolDocIds: [], memberDocIds: ['mem-1'] };
    mockMember = { name: 'Student', emails: ['student@example.com'] };
    await expect(assertAdminOrSchoolManager(makeReq('student@example.com'))).rejects.toThrowError(HttpsError);
  });
});

describe('recordTombstone', () => {
  it('records tombstone with docId, collection, and actor metadata', async () => {
    const setMock = vi.fn().mockResolvedValue(undefined);
    const docMock = vi.fn().mockReturnValue({ set: setMock });
    const subColMock = vi.fn().mockReturnValue({ doc: docMock });
    const sysDocMock = vi.fn().mockReturnValue({ collection: subColMock });
    const dbMock = {
      collection: vi.fn().mockReturnValue({ doc: sysDocMock }),
    } as any;

    const { recordTombstone } = await import('./common.js');
    await recordTombstone(dbMock, 'members', 'mem-123', {
      email: 'admin@example.com',
      name: 'Admin User',
      uid: 'uid-admin',
    });

    expect(dbMock.collection).toHaveBeenCalledWith('system');
    expect(sysDocMock).toHaveBeenCalledWith('deletions');
    expect(subColMock).toHaveBeenCalledWith('members');
    expect(docMock).toHaveBeenCalledWith('mem-123');
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'mem-123',
        collection: 'members',
        deletedBy: 'admin@example.com',
        deletedByName: 'Admin User',
        deletedByUid: 'uid-admin',
      }),
      { merge: true },
    );
  });

  it('records tombstone when actor is a simple string', async () => {
    const setMock = vi.fn().mockResolvedValue(undefined);
    const docMock = vi.fn().mockReturnValue({ set: setMock });
    const subColMock = vi.fn().mockReturnValue({ doc: docMock });
    const sysDocMock = vi.fn().mockReturnValue({ collection: subColMock });
    const dbMock = {
      collection: vi.fn().mockReturnValue({ doc: sysDocMock }),
    } as any;

    const { recordTombstone } = await import('./common.js');
    await recordTombstone(dbMock, 'schools', 'sch-999', 'superadmin@example.com');

    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 'sch-999',
        collection: 'schools',
        deletedBy: 'superadmin@example.com',
      }),
      { merge: true },
    );
  });
});

describe('recordDeletionLog', () => {
  it('saves full snapshot and actor metadata to deletion_logs', async () => {
    const setMock = vi.fn().mockResolvedValue(undefined);
    const docMock = vi.fn().mockReturnValue({ set: setMock });
    const colMock = vi.fn().mockReturnValue({ doc: docMock });
    const dbMock = {
      collection: colMock,
    } as any;

    const sampleMember = {
      name: 'Pietro Roselli',
      memberId: 'IT32',
      membershipType: 'Life',
    };

    const { recordDeletionLog } = await import('./common.js');
    const logId = await recordDeletionLog(
      dbMock,
      'members',
      'mem-it32',
      sampleMember,
      {
        email: 'admin@example.com',
        name: 'Admin User',
        uid: 'uid-1',
      },
      'cloud_function_trigger',
    );

    expect(logId).toBeDefined();
    expect(colMock).toHaveBeenCalledWith('deletion_logs');
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: 'members',
        docId: 'mem-it32',
        deletedBy: 'admin@example.com',
        deletedByName: 'Admin User',
        deletedByUid: 'uid-1',
        source: 'cloud_function_trigger',
        data: sampleMember,
      }),
    );
  });
});

