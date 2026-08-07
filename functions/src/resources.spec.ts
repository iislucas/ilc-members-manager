/* resources.spec.ts — unit tests for resource access control. */
import * as admin from 'firebase-admin';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertResourceAccess } from './resources';
import { ResourceAccessLevel, ACL } from './data-model';
import { HttpsError } from 'firebase-functions/v2/https';

describe('assertResourceAccess', () => {
  let mockAclDoc: Record<string, unknown> | null = null;

  beforeEach(() => {
    mockAclDoc = null;
    vi.spyOn(admin, 'firestore').mockReturnValue({
      collection: (col: string) => {
        if (col === 'acl') {
          return {
            doc: (docId: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: mockAclDoc !== null,
                data: () => mockAclDoc,
              }),
            }),
          };
        }
        return {} as any;
      },
    } as any);
  });

  const makeRequest = (email?: string) =>
    ({
      auth: email ? { token: { email }, uid: 'user-1' } : undefined,
      data: {},
      rawRequest: {} as any,
      accepts: () => true,
    }) as unknown as import('firebase-functions/v2/https').CallableRequest<unknown>;

  it('allows public resources without authentication', async () => {
    await expect(
      assertResourceAccess(makeRequest(), ResourceAccessLevel.Public),
    ).resolves.toBeUndefined();
  });

  it('throws unauthenticated for non-public resources if user is not logged in', async () => {
    await expect(
      assertResourceAccess(makeRequest(), ResourceAccessLevel.Instructors),
    ).rejects.toThrowError(HttpsError);

    try {
      await assertResourceAccess(makeRequest(), ResourceAccessLevel.Instructors);
    } catch (err: any) {
      expect(err.code).toBe('unauthenticated');
    }
  });

  it('throws permission-denied with reason no-acl if user has no ACL doc', async () => {
    mockAclDoc = null;
    try {
      await assertResourceAccess(
        makeRequest('tim@punkwood.studio'),
        ResourceAccessLevel.Instructors,
      );
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('permission-denied');
      expect(err.details?.reason).toBe('no-acl');
    }
  });

  describe('Instructor access level', () => {
    it('allows access if instructor license expires in the future', async () => {
      mockAclDoc = {
        instructorIds: ['289'],
        instructorLicenseExpires: '2028-05-11',
        isAdmin: false,
      };
      await expect(
        assertResourceAccess(
          makeRequest('tim@zxdpdx.com'),
          ResourceAccessLevel.Instructors,
        ),
      ).resolves.toBeUndefined();
    });

    it('allows access if instructor license is "life"', async () => {
      mockAclDoc = {
        instructorIds: ['289'],
        instructorLicenseExpires: 'life',
        isAdmin: false,
      };
      await expect(
        assertResourceAccess(
          makeRequest('tim@zxdpdx.com'),
          ResourceAccessLevel.Instructors,
        ),
      ).resolves.toBeUndefined();
    });

    it('throws permission-denied with reason missing when instructorLicenseExpires is empty string', async () => {
      mockAclDoc = {
        instructorIds: ['289'],
        instructorLicenseExpires: '',
        isAdmin: false,
      };
      try {
        await assertResourceAccess(
          makeRequest('tim@zxdpdx.com'),
          ResourceAccessLevel.Instructors,
        );
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('permission-denied');
        expect(err.message).toContain('You do not have an instructor license.');
        expect(err.details).toEqual({
          reason: 'missing',
          tier: 'instructor',
        });
      }
    });

    it('throws permission-denied with reason expired when instructorLicenseExpires is in the past', async () => {
      mockAclDoc = {
        instructorIds: ['289'],
        instructorLicenseExpires: '2020-01-01',
        isAdmin: false,
      };
      try {
        await assertResourceAccess(
          makeRequest('tim@zxdpdx.com'),
          ResourceAccessLevel.Instructors,
        );
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('permission-denied');
        expect(err.message).toContain('Your instructor license expired on 2020-01-01.');
        expect(err.details).toEqual({
          reason: 'expired',
          tier: 'instructor',
          expiryDate: '2020-01-01',
        });
      }
    });

    it('allows access for admins even if instructorLicenseExpires is empty', async () => {
      mockAclDoc = {
        isAdmin: true,
        instructorLicenseExpires: '',
      };
      await expect(
        assertResourceAccess(
          makeRequest('admin@iliqchuan.com'),
          ResourceAccessLevel.Instructors,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('Member access level', () => {
    it('allows access for active annual member', async () => {
      mockAclDoc = {
        membershipExpires: '2028-05-11',
        isAdmin: false,
      };
      await expect(
        assertResourceAccess(
          makeRequest('member@example.com'),
          ResourceAccessLevel.Members,
        ),
      ).resolves.toBeUndefined();
    });

    it('allows access for life member', async () => {
      mockAclDoc = {
        membershipExpires: 'life',
        isAdmin: false,
      };
      await expect(
        assertResourceAccess(
          makeRequest('member@example.com'),
          ResourceAccessLevel.Members,
        ),
      ).resolves.toBeUndefined();
    });

    it('throws permission-denied with reason missing when membershipExpires is empty', async () => {
      mockAclDoc = {
        membershipExpires: '',
        isAdmin: false,
      };
      try {
        await assertResourceAccess(
          makeRequest('member@example.com'),
          ResourceAccessLevel.Members,
        );
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('permission-denied');
        expect(err.details).toEqual({
          reason: 'missing',
          tier: 'membership',
        });
      }
    });

    it('throws permission-denied with reason expired when membershipExpires is in the past', async () => {
      mockAclDoc = {
        membershipExpires: '2020-01-01',
        isAdmin: false,
      };
      try {
        await assertResourceAccess(
          makeRequest('member@example.com'),
          ResourceAccessLevel.Members,
        );
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.code).toBe('permission-denied');
        expect(err.details).toEqual({
          reason: 'expired',
          tier: 'membership',
          expiryDate: '2020-01-01',
        });
      }
    });
  });
});
