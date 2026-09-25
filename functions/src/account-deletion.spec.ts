/*
 * Unit tests for account deletion Cloud Functions:
 * scheduleAccountDeletionHandler and cancelAccountDeletionHandler.
 * Verifies that regular members cannot schedule or cancel account deletions,
 * and only administrators have permission to manage deletions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import {
  scheduleAccountDeletionHandler,
  cancelAccountDeletionHandler,
} from './account-deletion';
import { CallableRequest } from 'firebase-functions/v2/https';

vi.mock('firebase-admin', () => {
  const firestoreMock = {
    collection: vi.fn(),
  };
  return {
    firestore: Object.assign(vi.fn(() => firestoreMock), {
      FieldValue: {
        serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
      },
    }),
  };
});

describe('account-deletion', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      collection: vi.fn(),
    };
    vi.spyOn(admin, 'firestore').mockReturnValue(mockDb as any);
  });

  describe('scheduleAccountDeletionHandler', () => {
    it('throws unauthenticated if request is not authenticated', async () => {
      const request: any = {
        auth: null,
        data: { memberDocId: 'member-1' },
      };
      await expect(scheduleAccountDeletionHandler(request)).rejects.toThrow(
        'Must be authenticated.',
      );
    });

    it('throws invalid-argument if memberDocId is missing', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: {},
      };
      await expect(scheduleAccountDeletionHandler(request)).rejects.toThrow(
        'memberDocId is required.',
      );
    });

    it('throws permission-denied if caller is a regular member (not admin)', async () => {
      const request: any = {
        auth: { token: { email: 'regular@example.com' } },
        data: { memberDocId: 'member-1' },
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

      await expect(scheduleAccountDeletionHandler(request)).rejects.toThrow(
        'Only administrators can schedule account deletion.',
      );
    });

    it('throws not-found if member doc does not exist', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: { memberDocId: 'member-not-found' },
      };

      const mockAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };

      const mockMemberRef = {
        get: vi.fn().mockResolvedValue({
          exists: false,
        }),
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') return { doc: vi.fn().mockReturnValue(mockAclRef) };
        if (col === 'members') return { doc: vi.fn().mockReturnValue(mockMemberRef) };
        return {};
      });

      await expect(scheduleAccountDeletionHandler(request)).rejects.toThrow(
        'Member not found.',
      );
    });

    it('successfully schedules deletion when called by an admin', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: { memberDocId: 'member-1' },
      };

      const mockAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };

      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      const mockMemberRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ name: 'Test Member', emails: ['member@example.com'] }),
        }),
        update: mockUpdate,
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') return { doc: vi.fn().mockReturnValue(mockAclRef) };
        if (col === 'members') return { doc: vi.fn().mockReturnValue(mockMemberRef) };
        return {};
      });

      const result = await scheduleAccountDeletionHandler(request);
      expect(result.success).toBe(true);
      expect(result.scheduledDeletionDate).toBeDefined();
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledDeletionDate: result.scheduledDeletionDate,
        }),
      );
    });
  });

  describe('cancelAccountDeletionHandler', () => {
    it('throws unauthenticated if request is not authenticated', async () => {
      const request: any = {
        auth: null,
        data: { memberDocId: 'member-1' },
      };
      await expect(cancelAccountDeletionHandler(request)).rejects.toThrow(
        'Must be authenticated.',
      );
    });

    it('throws permission-denied if caller is a regular member (not admin)', async () => {
      const request: any = {
        auth: { token: { email: 'regular@example.com' } },
        data: { memberDocId: 'member-1' },
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

      await expect(cancelAccountDeletionHandler(request)).rejects.toThrow(
        'Only administrators can cancel account deletion.',
      );
    });

    it('successfully cancels deletion when called by an admin', async () => {
      const request: any = {
        auth: { token: { email: 'admin@example.com' } },
        data: { memberDocId: 'member-1' },
      };

      const mockAclRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ isAdmin: true }),
        }),
      };

      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      const mockMemberRef = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ name: 'Test Member', scheduledDeletionDate: '2026-10-25' }),
        }),
        update: mockUpdate,
      };

      mockDb.collection.mockImplementation((col: string) => {
        if (col === 'acl') return { doc: vi.fn().mockReturnValue(mockAclRef) };
        if (col === 'members') return { doc: vi.fn().mockReturnValue(mockMemberRef) };
        return {};
      });

      const result = await cancelAccountDeletionHandler(request);
      expect(result.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledDeletionDate: '',
        }),
      );
    });
  });
});
