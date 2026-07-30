import * as admin from 'firebase-admin';
admin.initializeApp();

import { describe, it, expect, vi, beforeEach, beforeAll, Mock } from 'vitest';
import { Member, MembershipType, NotificationKind, MemberNotification } from './data-model';
import { environment } from './environment/environment.js';

// The `mail` collection documents written by sendTemplateEmail (see
// on-member-update.ts). Kept in sync with the payload passed to `add()` there.
interface MailDocument {
  to: string[];
  from: string;
  message: { subject: string; text: string; html: string };
}

// The custom overrides stored at `system/email-templates`, mirrored from the
// keys sendTemplateEmail reads off that document.
interface EmailTemplatesDoc {
  membershipActivatedSubject?: string;
  membershipActivatedBody?: string;
  instructorLicenseActivatedSubject?: string;
  instructorLicenseActivatedBody?: string;
}

// The notification variant emitted on instructor-license activation, used to
// type the `data.instructorId` assertion below.
type InstructorActivatedNotification = Extract<
  MemberNotification,
  { kind: NotificationKind.InstructorLicenseActivated }
>;

// Minimal Firestore mock surfaces — just the members/methods these handlers
// touch. Each `Mock` is a vi.fn(); the composite is cast to
// admin.firestore.Firestore at the call sites so the handler signatures are
// still type-checked.
interface MockDoc {
  collection: Mock;
  doc: Mock;
  where: Mock;
  get: Mock;
  set: Mock;
  delete: Mock;
  ref: { delete: Mock };
  id?: string;
  path?: string;
}
interface MockCollection {
  doc: Mock;
  add: Mock;
  where: Mock;
  get: Mock;
}
interface MockBatch {
  delete: Mock;
  set: Mock;
  commit: Mock;
}
interface MockFirestore {
  collection: Mock;
  doc: Mock;
  batch: Mock;
}

describe('on-member-update triggers logic', () => {
  type MemberUpdateModule = typeof import('./on-member-update.js');
  let handleMembershipActivation: MemberUpdateModule['handleMembershipActivation'];
  let handleInstructorActivation: MemberUpdateModule['handleInstructorActivation'];

  let mockDb: MockFirestore;
  let mockBatch: MockBatch;
  let mockCollection: MockCollection;
  let mockDoc: MockDoc;
  let mockWhere: Mock;
  let mockGet: Mock;
  let mockSet: Mock;
  let mockAdd: Mock;
  let mockDelete: Mock;
  let mockCommit: Mock;

  // Passes the mock Firestore to a handler as its real Firestore parameter, so
  // the handler's typed signature checks the member/previous arguments.
  const asFirestore = (db: MockFirestore) =>
    db as unknown as admin.firestore.Firestore;

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

      await handleMembershipActivation(asFirestore(mockDb), member, previous);

      // Verify cleanUpPendingNotifications called batch delete
      expect(mockBatch.delete).toHaveBeenCalledWith('mock-ref-1');
      expect(mockCommit).toHaveBeenCalled();

      // Verify createMemberNotification set the welcome notification
      expect(mockSet).toHaveBeenCalled();
      const setCall = mockSet.mock.calls[0][0] as MemberNotification;
      expect(setCall.kind).toBe(NotificationKind.MembershipActivated);
      expect(setCall.markdown).toContain('Welcome to the I Liq Chuan family');
      expect(setCall.markdown).toContain('](/members-area)');

      // Verify email was enqueued
      expect(mockAdd).toHaveBeenCalled();
      const addCall = mockAdd.mock.calls[0][0] as MailDocument;
      expect(addCall.to).toEqual(['member-email@example.com']);
      expect(addCall.message.subject).toBe('Welcome to the I Liq Chuan Family!');
      expect(addCall.message.html).toContain('Welcome to the I Liq Chuan family');
      expect(addCall.message.html).toContain(`${environment.links.appBase}/members-area`);
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
      mockGet.mockImplementation(async function (this: { id?: string }) {
        if (this.id === 'email-templates') {
          const templates: EmailTemplatesDoc = {
            membershipActivatedSubject: 'Welcome {name} ({memberId})!',
            membershipActivatedBody: 'Hello {name}, your email is {email} and ID is {memberId}.',
          };
          return {
            exists: true,
            data: () => templates,
          };
        }
        return { empty: true, docs: [] };
      });

      await handleMembershipActivation(asFirestore(mockDb), member, previous);

      expect(mockAdd).toHaveBeenCalled();
      const addCall = mockAdd.mock.calls[0][0] as MailDocument;
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

      await handleMembershipActivation(asFirestore(mockDb), member, previous);

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

      await handleMembershipActivation(asFirestore(mockDb), member, previous);

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

      await handleInstructorActivation(asFirestore(mockDb), member, previous);

      expect(mockBatch.delete).toHaveBeenCalledWith('mock-ref-2');
      expect(mockCommit).toHaveBeenCalled();

      expect(mockSet).toHaveBeenCalled();
      const setCall = mockSet.mock.calls[0][0] as InstructorActivatedNotification;
      expect(setCall.kind).toBe(NotificationKind.InstructorLicenseActivated);
      expect(setCall.markdown).toContain('Congratulations on getting your Instructor ID');
      expect(setCall.data.instructorId).toBe('INST-777');
      // Regression: in-app links must be root-relative paths. A legacy `#/...`
      // href only resolves on a full page load (see the rewrite in main.ts), so
      // clicking one inside the running app does nothing at all.
      expect(setCall.markdown).not.toContain('](#/');
      expect(setCall.markdown).toContain('](/myProfile)');
      expect(setCall.markdown).toContain(`](${environment.links.instructorSopPath})`);

      // Verify email was enqueued
      expect(mockAdd).toHaveBeenCalled();
      const addCall = mockAdd.mock.calls[0][0] as MailDocument;
      expect(addCall.to).toEqual(['instructor-email@example.com']);
      expect(addCall.message.subject).toBe('Congratulations on your Instructor License!');
      expect(addCall.message.html).toContain('Congratulations on getting your Instructor ID');
      expect(addCall.message.html).toContain('INST-777');
      // Email links have no app to resolve against, so they must be absolute.
      expect(addCall.message.html).toContain(`${environment.links.appBase}/myProfile`);
      expect(addCall.message.html).toContain(
        `${environment.links.appBase}${environment.links.instructorSopPath}`,
      );
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

      await handleInstructorActivation(asFirestore(mockDb), member, previous);

      expect(mockSet).not.toHaveBeenCalled();
      expect(mockBatch.delete).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });
});
