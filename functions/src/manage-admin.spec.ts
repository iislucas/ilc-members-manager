import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { setAdminPrivilegeHelper } from './manage-admin';

vi.mock('firebase-admin', () => {
  const firestoreMock = {
    collection: vi.fn(),
  };
  return {
    firestore: vi.fn(() => firestoreMock),
  };
});

function makeQueryMock(docs: any[]) {
  const result = {
    empty: docs.length === 0,
    size: docs.length,
    docs,
  };
  return {
    limit: vi.fn().mockReturnValue({
      get: vi.fn().mockResolvedValue(result),
    }),
    get: vi.fn().mockResolvedValue(result),
  };
}

describe('manage-admin', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      collection: vi.fn(),
    };
    vi.spyOn(admin, 'firestore').mockReturnValue(mockDb as any);
  });

  describe('setAdminPrivilegeHelper', () => {
    it('throws unauthenticated if request is not authenticated', async () => {
      const request: any = { auth: null, data: { email: 'test@example.com', isAdmin: true } };
      await expect(setAdminPrivilegeHelper(request)).rejects.toThrow('The function must be called while authenticated.');
    });

    it('throws permission-denied if caller is not an admin', async () => {
      const request: any = {
        auth: { token: { email: 'user@example.com' } },
        data: { email: 'target@example.com', isAdmin: true },
      };

      const mockAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: false }),
        }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') return { doc: vi.fn().mockReturnValue(mockAclRef) };
        return {};
      });

      await expect(setAdminPrivilegeHelper(request)).rejects.toThrow('You do not have permission to perform this action.');
    });

    it('throws invalid-argument if target email is invalid', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: { email: 'invalid-email', isAdmin: true },
      };

      const callerAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };
      const callerMemberRef = {
        exists: true,
        data: () => ({ name: 'Admin', docId: 'm1' }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') return { doc: vi.fn().mockReturnValue(callerAclRef) };
        if (col === 'members') return { where: vi.fn().mockReturnValue(makeQueryMock([callerMemberRef])) };
        return {};
      });

      await expect(setAdminPrivilegeHelper(request)).rejects.toThrow('Invalid email address format.');
    });

    it('throws failed-precondition if caller attempts to revoke their own admin access', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: { email: 'admin@example.com', isAdmin: false },
      };

      const callerAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };
      const callerMemberRef = {
        exists: true,
        data: () => ({ name: 'Admin', docId: 'm1' }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') return { doc: vi.fn().mockReturnValue(callerAclRef) };
        if (col === 'members') return { where: vi.fn().mockReturnValue(makeQueryMock([callerMemberRef])) };
        return {};
      });

      await expect(setAdminPrivilegeHelper(request)).rejects.toThrow('You cannot revoke your own administrator privileges.');
    });

    it('throws failed-precondition if attempting to revoke the last remaining admin', async () => {
      const request: any = {
        auth: { token: { email: 'admin1@example.com' } },
        data: { email: 'admin2@example.com', isAdmin: false },
      };

      const callerAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };
      const callerMemberRef = {
        exists: true,
        data: () => ({ name: 'Admin 1', docId: 'm1' }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') {
          return {
            doc: vi.fn().mockReturnValue(callerAclRef),
            where: vi.fn().mockImplementation((field, op, val) => {
              if (field === 'isAdmin' && val === true) {
                return makeQueryMock([{ id: 'admin2@example.com' }]);
              }
              return makeQueryMock([]);
            }),
          };
        }
        if (col === 'members') return { where: vi.fn().mockReturnValue(makeQueryMock([callerMemberRef])) };
        return {};
      });

      await expect(setAdminPrivilegeHelper(request)).rejects.toThrow('Cannot revoke the last remaining system administrator.');
    });

    it('grants admin status to an existing ACL document', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: { email: 'newadmin@example.com', isAdmin: true },
      };

      const callerAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };
      const targetAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: false, memberDocIds: ['m2'] }),
        }),
        update: vi.fn().mockResolvedValue(undefined),
      };
      const callerMemberRef = {
        exists: true,
        data: () => ({ name: 'Admin', docId: 'm1' }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') {
          return {
            doc: vi.fn().mockImplementation((id: string) => {
              if (id === 'admin@example.com') return callerAclRef;
              if (id === 'newadmin@example.com') return targetAclRef;
              return {};
            }),
          };
        }
        if (col === 'members') return { where: vi.fn().mockReturnValue(makeQueryMock([callerMemberRef])) };
        return {};
      });

      const res = await setAdminPrivilegeHelper(request);

      expect(res).toEqual({
        success: true,
        email: 'newadmin@example.com',
        isAdmin: true,
      });
      expect(targetAclRef.update).toHaveBeenCalledWith({ isAdmin: true });
    });

    it('creates new ACL document with matching memberDocIds if target has no prior ACL', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: { email: 'freshadmin@example.com', isAdmin: true },
      };

      const callerAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };
      const targetAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: false,
        }),
        set: vi.fn().mockResolvedValue(undefined),
      };
      const callerMemberRef = {
        exists: true,
        data: () => ({ name: 'Admin', docId: 'm1' }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') {
          return {
            doc: vi.fn().mockImplementation((id: string) => {
              if (id === 'admin@example.com') return callerAclRef;
              if (id === 'freshadmin@example.com') return targetAclRef;
              return {};
            }),
          };
        }
        if (col === 'members') {
          return {
            where: vi.fn().mockImplementation((field, op, val) => {
              if (val === 'freshadmin@example.com') {
                return makeQueryMock([{ id: 'm-fresh' }]);
              }
              return makeQueryMock([callerMemberRef]);
            }),
          };
        }
        return {};
      });

      const res = await setAdminPrivilegeHelper(request);

      expect(res.success).toBe(true);
      expect(res.isAdmin).toBe(true);
      expect(targetAclRef.set).toHaveBeenCalledWith({
        isAdmin: true,
        memberDocIds: ['m-fresh'],
        instructorIds: [],
        schoolDocIds: [],
        membershipExpires: '',
        instructorLicenseExpires: '',
        schoolLicenseExpires: '',
        notYetLinkedToMember: false,
      });
    });

    it('revokes admin status and updates ACL if memberDocIds exist', async () => {
      const request: any = {
        auth: { token: { email: 'superadmin@example.com' } },
        data: { email: 'demote@example.com', isAdmin: false },
      };

      const callerAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };
      const targetAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true, memberDocIds: ['m3'] }),
        }),
        update: vi.fn().mockResolvedValue(undefined),
      };
      const callerMemberRef = {
        exists: true,
        data: () => ({ name: 'Super Admin', docId: 'm1' }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') {
          return {
            doc: vi.fn().mockImplementation((id: string) => {
              if (id === 'superadmin@example.com') return callerAclRef;
              if (id === 'demote@example.com') return targetAclRef;
              return {};
            }),
            where: vi.fn().mockReturnValue(makeQueryMock([
              { id: 'superadmin@example.com' },
              { id: 'demote@example.com' },
            ])),
          };
        }
        if (col === 'members') return { where: vi.fn().mockReturnValue(makeQueryMock([callerMemberRef])) };
        return {};
      });

      const res = await setAdminPrivilegeHelper(request);

      expect(res.success).toBe(true);
      expect(res.isAdmin).toBe(false);
      expect(targetAclRef.update).toHaveBeenCalledWith({ isAdmin: false });
    });

    it('deletes ACL document on revocation if memberDocIds is empty', async () => {
      const request: any = {
        auth: { token: { email: 'superadmin@example.com' } },
        data: { email: 'standalone@example.com', isAdmin: false },
      };

      const callerAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };
      const targetAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true, memberDocIds: [] }),
        }),
        delete: vi.fn().mockResolvedValue(undefined),
      };
      const callerMemberRef = {
        exists: true,
        data: () => ({ name: 'Super Admin', docId: 'm1' }),
      };

      const mockDeletionLogSet = vi.fn().mockResolvedValue(undefined);
      const mockTombstoneSet = vi.fn().mockResolvedValue(undefined);

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') {
          return {
            doc: vi.fn().mockImplementation((id: string) => {
              if (id === 'superadmin@example.com') return callerAclRef;
              if (id === 'standalone@example.com') return targetAclRef;
              return {};
            }),
            where: vi.fn().mockReturnValue(makeQueryMock([
              { id: 'superadmin@example.com' },
              { id: 'standalone@example.com' },
            ])),
          };
        }
        if (col === 'members') return { where: vi.fn().mockReturnValue(makeQueryMock([callerMemberRef])) };
        if (col === 'deletion_logs') {
          return {
            doc: vi.fn().mockReturnValue({ set: mockDeletionLogSet }),
          };
        }
        if (col === 'system') {
          return {
            doc: vi.fn().mockReturnValue({
              collection: vi.fn().mockReturnValue({
                doc: vi.fn().mockReturnValue({ set: mockTombstoneSet }),
              }),
            }),
          };
        }
        return {};
      });

      const res = await setAdminPrivilegeHelper(request);

      expect(res.success).toBe(true);
      expect(res.isAdmin).toBe(false);
      expect(targetAclRef.delete).toHaveBeenCalledTimes(1);
      expect(mockDeletionLogSet).toHaveBeenCalledTimes(1);
      expect(mockTombstoneSet).toHaveBeenCalledTimes(1);
    });
  });
});
