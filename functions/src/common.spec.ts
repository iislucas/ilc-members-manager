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

describe('sanitizeForFirestore', () => {
  it('strips undefined fields while preserving Firestore Timestamp instances', async () => {
    const { sanitizeForFirestore } = await import('./common.js');
    const admin = await import('firebase-admin');

    const ts = admin.firestore.Timestamp.fromDate(new Date('2026-01-15T12:00:00Z'));
    const input = {
      name: 'Test Member',
      undefinedField: undefined,
      lastUpdated: ts,
      nested: {
        keep: 'yes',
        remove: undefined,
        nestedTs: ts,
      },
      list: ['item1', undefined, 'item2'],
    };

    const sanitized = sanitizeForFirestore(input);

    expect(sanitized.name).toBe('Test Member');
    expect('undefinedField' in sanitized).toBe(false);
    expect(sanitized.lastUpdated).toBe(ts);
    expect(sanitized.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);
    expect(sanitized.nested.keep).toBe('yes');
    expect('remove' in sanitized.nested).toBe(false);
    expect(sanitized.nested.nestedTs).toBe(ts);
    expect(sanitized.list).toEqual(['item1', 'item2']);
  });

  it('converts serialized timestamp objects {_seconds, _nanoseconds} to native Timestamps', async () => {
    const { sanitizeForFirestore } = await import('./common.js');
    const admin = await import('firebase-admin');

    const serializedTs = { _seconds: 1700000000, _nanoseconds: 500000000 };
    const input = {
      lastUpdated: serializedTs,
    };

    const sanitized = sanitizeForFirestore(input);
    expect(sanitized.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);
    expect((sanitized.lastUpdated as unknown as admin.firestore.Timestamp).seconds).toBe(1700000000);
    expect((sanitized.lastUpdated as unknown as admin.firestore.Timestamp).nanoseconds).toBe(500000000);
  });
});

describe('recordDeletionLog', () => {
  it('saves full snapshot and actor metadata to deletion_logs, preserving Timestamps and removing undefined', async () => {
    const setMock = vi.fn().mockResolvedValue(undefined);
    const docMock = vi.fn().mockReturnValue({ set: setMock });
    const colMock = vi.fn().mockReturnValue({ doc: docMock });
    const dbMock = {
      collection: colMock,
    } as any;

    const admin = await import('firebase-admin');
    const ts = admin.firestore.Timestamp.now();
    const sampleMember = {
      name: 'Pietro Roselli',
      memberId: 'IT32',
      membershipType: 'Life',
      lastUpdated: ts,
      undefinedField: undefined,
    };

    const { recordDeletionLog } = await import('./common.js');
    const { DeletionSource } = await import('./data-model/deletion-logs.js');
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
      DeletionSource.CloudFunctionTrigger,
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
        source: DeletionSource.CloudFunctionTrigger,
        data: expect.objectContaining({
          name: 'Pietro Roselli',
          memberId: 'IT32',
          membershipType: 'Life',
          lastUpdated: ts,
        }),
      }),
    );
    // Ensure undefined field was removed
    const callArg = setMock.mock.calls[0][0];
    expect('undefinedField' in callArg.data).toBe(false);
    expect(callArg.data.lastUpdated instanceof admin.firestore.Timestamp).toBe(true);
  });
});


