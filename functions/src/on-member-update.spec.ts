import * as admin from 'firebase-admin';
admin.initializeApp();

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Member, MembershipType, NotificationKind } from './data-model';
import { environment } from './environment/environment.js';

describe('on-member-update triggers logic', () => {
  let handleMembershipActivation: any;
  let handleInstructorActivation: any;

  let mockDb: any;
  let mockBatch: any;
  let mockCollection: any;
  let mockDoc: any;
  let mockWhere: any;
  let mockGet: any;
  let mockSet: any;
  let mockAdd: any;
  let mockDelete: any;
  let mockCommit: any;

  beforeAll(async () => {
    // Dynamically import to ensure admin.initializeApp() runs first.
    const mod = await import('./on-member-update.js');
    handleMembershipActivation = mod.handleMembershipActivation;
    handleInstructorActivation = mod.handleInstructorActivation;
  });

  beforeEach(() => {
    environment.email = { from: 'info@iliqchuan.com' };
    mockSet = vi.fn().mockResolvedValue({});
    mockAdd = vi.fn().mockResolvedValue({});
    mockDelete = vi.fn();
    mockCommit = vi.fn().mockResolvedValue({});
    mockGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    mockWhere = vi.fn().mockReturnThis();

    mockDoc = {
      collection: vi.fn().mockReturnThis(),
      doc: vi.fn().mockReturnThis(),
      where: mockWhere,
      get: mockGet,
      set: mockSet,
      delete: mockDelete,
      ref: { delete: mockDelete },
    };

    mockCollection = {
      doc: vi.fn().mockReturnValue(mockDoc),
      add: mockAdd,
      where: mockWhere,
      get: mockGet,
    };

    mockBatch = {
      delete: vi.fn(),
      set: vi.fn(),
      commit: mockCommit,
    };

    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
      doc: vi.fn().mockImplementation((path) => {
        const parts = path.split('/');
        return {
          ...mockDoc,
          id: parts[parts.length - 1],
          path: path,
        };
      }),
      batch: vi.fn().mockReturnValue(mockBatch),
    };
    mockCollection.doc = vi.fn().mockImplementation((docId) => {
      return {
        ...mockDoc,
        id: docId,
      };
    });
  });

  describe('handleMembershipActivation', () => {
    it('should send welcome notification and cleanup pending notifications when membership becomes active', async () => {
      const member = {
        docId: 'member-123',
        membershipType: MembershipType.Annual,
        emails: ['member-email@example.com'],
      } as Member;

      const previous = {
        docId: 'member-123',
        membershipType: MembershipType.NotYetAMember,
        emails: ['member-email@example.com'],
      } as Member;

      // Mock get to return one pending notification
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: 'mock-ref-1' }],
      });

      await handleMembershipActivation(mockDb, member, previous);

      // Verify cleanUpPendingNotifications called batch delete
      expect(mockBatch.delete).toHaveBeenCalledWith('mock-ref-1');
      expect(mockCommit).toHaveBeenCalled();

      // Verify createMemberNotification set the welcome notification
      expect(mockSet).toHaveBeenCalled();
      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.kind).toBe(NotificationKind.MembershipActivated);
      expect(setCall.markdown).toContain('Welcome to the I Liq Chuan family');

      // Verify email was enqueued
      expect(mockAdd).toHaveBeenCalled();
      const addCall = mockAdd.mock.calls[0][0];
      expect(addCall.to).toEqual(['member-email@example.com']);
      expect(addCall.message.subject).toBe('Welcome to the I Liq Chuan Family!');
      expect(addCall.message.html).toContain('Welcome to the I Liq Chuan family');
    });

    it('should use custom templates from Firestore system/email-templates document if present', async () => {
      const member = {
        docId: 'member-123',
        membershipType: MembershipType.Annual,
        emails: ['member-email@example.com'],
        name: 'John Doe',
        memberId: 'US456',
      } as Member;

      const previous = {
        docId: 'member-123',
        membershipType: MembershipType.NotYetAMember,
        emails: ['member-email@example.com'],
      } as Member;

      // Mock get to return custom templates document
      mockGet.mockImplementation(async function(this: any) {
        if (this.id === 'email-templates') {
          return {
            exists: true,
            data: () => ({
              membershipActivatedSubject: 'Welcome {name} ({memberId})!',
              membershipActivatedBody: 'Hello {name}, your email is {email} and ID is {memberId}.',
            }),
          };
        }
        return { empty: true, docs: [] };
      });

      await handleMembershipActivation(mockDb, member, previous);

      expect(mockAdd).toHaveBeenCalled();
      const addCall = mockAdd.mock.calls[0][0];
      expect(addCall.to).toEqual(['member-email@example.com']);
      expect(addCall.message.subject).toBe('Welcome John Doe (US456)!');
      expect(addCall.message.html).toContain('Hello John Doe, your email is member-email@example.com and ID is US456.');
    });

    it('should NOT enqueue an email if environment.email.from is not configured', async () => {
      environment.email = { from: '' };

      const member = {
        docId: 'member-123',
        membershipType: MembershipType.Annual,
        emails: ['member-email@example.com'],
      } as Member;

      const previous = {
        docId: 'member-123',
        membershipType: MembershipType.NotYetAMember,
        emails: ['member-email@example.com'],
      } as Member;

      await handleMembershipActivation(mockDb, member, previous);

      // Verify createMemberNotification was still called (in-app notification still works)
      expect(mockSet).toHaveBeenCalled();

      // Verify email was NOT enqueued
      expect(mockAdd).not.toHaveBeenCalled();
    });

    it('should do nothing if membership type is unchanged or active status is unchanged', async () => {
      const member = {
        docId: 'member-123',
        membershipType: MembershipType.Annual,
        emails: ['member-email@example.com'],
      } as Member;

      const previous = {
        docId: 'member-123',
        membershipType: MembershipType.Annual,
        emails: ['member-email@example.com'],
      } as Member;

      await handleMembershipActivation(mockDb, member, previous);

      expect(mockSet).not.toHaveBeenCalled();
      expect(mockBatch.delete).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  describe('handleInstructorActivation', () => {
    it('should send instructor welcome notification and cleanup pending when instructorId is assigned', async () => {
      const member = {
        docId: 'member-123',
        instructorId: 'INST-777',
        emails: ['instructor-email@example.com'],
      } as Member;

      const previous = {
        docId: 'member-123',
        instructorId: '',
        emails: ['instructor-email@example.com'],
      } as Member;

      // Mock get to return one pending notification
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: 'mock-ref-2' }],
      });

      await handleInstructorActivation(mockDb, member, previous);

      expect(mockBatch.delete).toHaveBeenCalledWith('mock-ref-2');
      expect(mockCommit).toHaveBeenCalled();

      expect(mockSet).toHaveBeenCalled();
      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.kind).toBe(NotificationKind.InstructorLicenseActivated);
      expect(setCall.markdown).toContain('Congratulations on getting your Instructor ID');
      expect(setCall.data.instructorId).toBe('INST-777');

      // Verify email was enqueued
      expect(mockAdd).toHaveBeenCalled();
      const addCall = mockAdd.mock.calls[0][0];
      expect(addCall.to).toEqual(['instructor-email@example.com']);
      expect(addCall.message.subject).toBe('Congratulations on your Instructor License!');
      expect(addCall.message.html).toContain('Congratulations on getting your Instructor ID');
      expect(addCall.message.html).toContain('INST-777');
    });

    it('should do nothing if instructorId remains unchanged or empty', async () => {
      const member = {
        docId: 'member-123',
        instructorId: '',
        emails: ['instructor-email@example.com'],
      } as Member;

      const previous = {
        docId: 'member-123',
        instructorId: '',
        emails: ['instructor-email@example.com'],
      } as Member;

      await handleInstructorActivation(mockDb, member, previous);

      expect(mockSet).not.toHaveBeenCalled();
      expect(mockBatch.delete).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });
});
