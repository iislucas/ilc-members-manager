import { describe, it, expect, vi } from 'vitest';
import {
  generateBackendNotificationDocId,
  createMemberNotification,
  toSnakeCase,
  gradingStageFromKind,
} from './notifications';
import {
  NotificationKind,
  NotificationAudience,
  notificationAudience,
  MemberNotification,
} from './data-model/notifications';
import { OrderStatus } from './data-model/orders';

describe('backend notifications helper', () => {
  describe('toSnakeCase', () => {
    it('converts PascalCase and camelCase to snake_case', () => {
      expect(toSnakeCase('MembershipActivated')).toBe('membership_activated');
      expect(toSnakeCase('InstructorLicenseActivated')).toBe(
        'instructor_license_activated',
      );
      expect(toSnakeCase('PrimaryInstructorRemoved')).toBe(
        'primary_instructor_removed',
      );
      expect(toSnakeCase('MembershipMarkedInactive')).toBe(
        'membership_marked_inactive',
      );
    });
  });

  describe('gradingStageFromKind', () => {
    it('maps grading notification kinds to stage suffixes', () => {
      expect(
        gradingStageFromKind(NotificationKind.GradingRequestsYouAsInstructor),
      ).toBe('grading_request_instructor');
      expect(
        gradingStageFromKind(NotificationKind.GradingManagerAdded),
      ).toBe('grading_manager_added');
      expect(
        gradingStageFromKind(NotificationKind.GradingManagerRemoved),
      ).toBe('grading_manager_removed');
      expect(
        gradingStageFromKind(NotificationKind.GradingPassed),
      ).toBe('grading_passed');
      expect(
        gradingStageFromKind(NotificationKind.GradingNotPassed),
      ).toBe('grading_not_passed');
    });
  });

  describe('generateBackendNotificationDocId', () => {
    it('keys orders by orderDocId with purpose', () => {
      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.PurchaseFulfilled,
            markdown: 'Order processed',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: {
              orderDocId: 'order_123',
              orderId: 'order_123',
              summary: 'Annual Membership',
            },
          },
          'rand_id',
        ),
      ).toBe('order_123_purchase_fulfilled');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.MembershipPending,
            markdown: 'Membership pending',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: {
              orderId: 'sq_order_456',
              summary: 'Membership Pending',
            },
          },
          'rand_id',
        ),
      ).toBe('sq_order_456_membership_pending');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.OrderNeedsAttention,
            markdown: 'Order issue',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: {
              orderDocId: 'order_789',
              orderRef: '789',
              status: OrderStatus.NeedsManualProcessing,
              issues: ['Missing customer email'],
            },
          },
          'rand_id',
        ),
      ).toBe('order_789_order_issue');
    });

    it('keys events by eventDocId with purpose and order ID when available', () => {
      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.EventRegistrationConfirmed,
            markdown: 'Registration confirmed',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: { eventId: 'event_abc', orderDocId: 'order_123' },
          },
          'rand_id',
        ),
      ).toBe('event_abc_order_123_event_reg');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.EventRegistrationConfirmed,
            markdown: 'Registration confirmed',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: { eventId: 'event_abc' },
          },
          'rand_id',
        ),
      ).toBe('event_abc_event_reg');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.EventVideoAvailable,
            markdown: 'Video ready',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: { eventId: 'event_abc', videoId: 'vid_1' },
          },
          'rand_id',
        ),
      ).toBe('event_abc_event_video');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.NewEventPosted,
            markdown: 'Event posted',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: { eventId: 'event_abc' },
          },
          'rand_id',
        ),
      ).toBe('event_abc_new_event_posted');
    });

    it('keys gradings by gradingDocId, safe timestamp, and stage', () => {
      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.GradingManagerAdded,
            markdown: 'Assigned as manager',
            createdAt: '2026-09-20T00:15:30Z',
            dismissed: false,
            data: {
              gradingDocId: 'grading_xyz',
              studentName: 'Student Name',
              level: 'Entry Level',
            },
          },
          'rand_id',
        ),
      ).toBe('grading_xyz_2026-09-20T00-15-30Z_grading_manager_added');
    });

    it('keys VOD video access by target video or series ID', () => {
      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.VideoAccessGranted,
            markdown: 'Video granted',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: {
              videoId: 'video_m1',
              title: 'Test Video',
              grantKind: 'purchase',
            },
          },
          'rand_id',
        ),
      ).toBe('video_m1_video_access_granted');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.VideoGiftReceived,
            markdown: 'Gift received',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: {
              seriesId: 'series_tai_chi',
              title: 'Tai Chi Series',
              grantKind: 'gift',
            },
          },
          'rand_id',
        ),
      ).toBe('series_tai_chi_video_gift_received');
    });

    it('keys uploads by uploadDocId', () => {
      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.NewUpload,
            markdown: 'New upload',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: {
              uploadDocId: 'upload_999',
              memberDocId: 'member_123',
              uploadName: 'upload.mp4',
            },
          },
          'rand_id',
        ),
      ).toBe('upload_999_upload');
    });

    it('keys member profile transitions with newDocId postfixed by kind', () => {
      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.MembershipActivated,
            markdown: 'Welcome!',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: {},
          },
          'random_uuid_123',
        ),
      ).toBe('random_uuid_123_membership_activated');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.InstructorLicenseActivated,
            markdown: 'Congrats on instructor license!',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: { instructorId: 'US123' },
          },
          'random_uuid_456',
        ),
      ).toBe('random_uuid_456_instructor_license_activated');

      expect(
        generateBackendNotificationDocId(
          {
            kind: NotificationKind.PrimaryInstructorRemoved,
            markdown: 'Instructor removed',
            createdAt: '2026-09-20T00:00:00Z',
            dismissed: false,
            data: { instructorId: 'US123' },
          },
          'random_uuid_789',
        ),
      ).toBe('random_uuid_789_primary_instructor_removed');
    });
  });

  describe('createMemberNotification', () => {
    it('sets the notification document idempotently using deterministic ID', async () => {
      const mockSet = vi.fn().mockResolvedValue(undefined);
      const mockDocRef = { id: 'order_123_purchase_fulfilled', set: mockSet };
      const mockCollection = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };
      const mockMemberDoc = {
        collection: vi.fn().mockReturnValue(mockCollection),
      };
      const mockDb = {
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue(mockMemberDoc),
        }),
      } as any;

      const notification: Omit<MemberNotification, 'docId'> = {
        kind: NotificationKind.PurchaseFulfilled,
        markdown: 'Your order was fulfilled',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        data: {
          orderDocId: 'order_123',
          orderId: 'order_123',
          summary: 'Order Fulfilled',
        },
      };

      await createMemberNotification(mockDb, 'member_456', notification);

      expect(mockCollection.doc).toHaveBeenCalledWith(
        'order_123_purchase_fulfilled',
      );
      expect(mockSet).toHaveBeenCalledWith({
        ...notification,
        docId: 'order_123_purchase_fulfilled',
      });
    });
  });

  describe('notificationAudience', () => {
    it('returns explicit audience when set on the notification', () => {
      const notif: MemberNotification = {
        docId: 'test-1',
        markdown: 'Test',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.PurchaseFulfilled,
        audience: NotificationAudience.Public,
        data: { orderId: '123', summary: 'Item' },
      };
      expect(notificationAudience(notif)).toBe(NotificationAudience.Public);
    });

    it('identifies admin-only notifications', () => {
      const adminKinds = [
        NotificationKind.PendingEventApproval,
        NotificationKind.PendingEventsSummary,
        NotificationKind.OrderNeedsAttention,
        NotificationKind.OrderIssuesSummary,
        NotificationKind.ManualOrderFulfilled,
        NotificationKind.NewUpload,
        NotificationKind.NewUploadsSummary,
      ];
      for (const kind of adminKinds) {
        const notif = {
          docId: 'test-admin',
          markdown: 'Admin alert',
          createdAt: '2026-09-20T00:00:00Z',
          dismissed: false,
          kind,
          data: {} as any,
        } as unknown as MemberNotification;
        expect(notificationAudience(notif)).toBe(NotificationAudience.Admin);
      }
    });

    it('identifies public notifications', () => {
      const notif: MemberNotification = {
        docId: 'test-public',
        markdown: 'New public event',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.NewEventPosted,
        data: { eventId: 'evt-1', title: 'Summer Retreat' },
      };
      expect(notificationAudience(notif)).toBe(NotificationAudience.Public);
    });

    it('identifies instructor broadcast notifications (and only instructor posts)', () => {
      const postNotif: MemberNotification = {
        docId: 'test-inst-post',
        markdown: 'Instructor SOP updated',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPost,
        data: {
          blogPath: 'instructors-post',
          blogCategory: '',
          lastSeenDateStr: '',
        },
      };
      expect(notificationAudience(postNotif)).toBe(
        NotificationAudience.Instructors,
      );

      const summaryNotif: MemberNotification = {
        docId: 'test-inst-summary',
        markdown: '3 new instructor posts',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPostsSummary,
        data: {
          count: 3,
          feedLabel: 'Instructors',
          feedCollection: 'instructors-post',
          areaRoute: '',
        },
      };
      expect(notificationAudience(summaryNotif)).toBe(
        NotificationAudience.Instructors,
      );
    });

    it('identifies member broadcast notifications', () => {
      const postNotif: MemberNotification = {
        docId: 'test-mem-post',
        markdown: 'New members post',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPost,
        data: {
          blogPath: 'members-post',
          blogCategory: '',
          lastSeenDateStr: '',
        },
      };
      expect(notificationAudience(postNotif)).toBe(
        NotificationAudience.Members,
      );

      const summaryNotif: MemberNotification = {
        docId: 'test-mem-summary',
        markdown: '2 new member posts',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPostsSummary,
        data: {
          count: 2,
          feedLabel: 'Members',
          feedCollection: 'members-post',
          areaRoute: '',
        },
      };
      expect(notificationAudience(summaryNotif)).toBe(
        NotificationAudience.Members,
      );
    });

    it('identifies personal notifications as "you", including GradingRequestsYouAsInstructor', () => {
      const reqNotif: MemberNotification = {
        docId: 'test-req',
        markdown: 'Student requested you as instructor',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.GradingRequestsYouAsInstructor,
        data: {
          gradingDocId: 'g-1',
          studentName: 'Alex',
          level: 'Student 1',
        },
      };
      expect(notificationAudience(reqNotif)).toBe(NotificationAudience.You);

      const managerNotif: MemberNotification = {
        docId: 'test-mgr',
        markdown: 'Added as grading manager',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.GradingManagerAdded,
        data: {
          gradingDocId: 'g-1',
          studentName: 'Alex',
          level: 'Student 1',
        },
      };
      expect(notificationAudience(managerNotif)).toBe(NotificationAudience.You);

      const purchaseNotif: MemberNotification = {
        docId: 'test-purchase',
        markdown: 'Purchase fulfilled',
        createdAt: '2026-09-20T00:00:00Z',
        dismissed: false,
        kind: NotificationKind.PurchaseFulfilled,
        data: { orderId: '123', summary: 'Membership' },
      };
      expect(notificationAudience(purchaseNotif)).toBe(NotificationAudience.You);
    });
  });
});
