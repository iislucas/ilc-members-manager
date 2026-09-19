import { describe, it, expect, vi } from 'vitest';
import {
  generateBackendNotificationDocId,
  createMemberNotification,
  toSnakeCase,
  gradingStageFromKind,
} from './notifications';
import {
  NotificationKind,
  MemberNotification,
} from './data-model/notifications';

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
            data: { orderDocId: 'order_123' },
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
            data: { orderId: 'sq_order_456' },
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
            data: { orderDocId: 'order_789' },
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
            data: { gradingDocId: 'grading_xyz' },
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
            data: { videoId: 'video_m1' },
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
            data: { seriesId: 'series_tai_chi' },
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
            data: { uploadDocId: 'upload_999' },
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
        data: { orderDocId: 'order_123' },
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
});
