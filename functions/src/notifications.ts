/*
Shared helper for writing member notifications.

Member notifications live at /members/{memberDocId}/notifications/{id} and are
streamed to the client by NotificationService. This helper centralises the
"create a notification" logic using deterministic, entity-connected document IDs
to guarantee idempotent writes and eliminate check-then-act race conditions.
*/

import * as admin from 'firebase-admin';
import {
  MemberNotification,
  NotificationKind,
} from './data-model/notifications';

/**
 * Converts a PascalCase or camelCase string to snake_case.
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

/**
 * Derives a human-readable stage/suffix for a grading notification kind.
 */
export function gradingStageFromKind(kind: NotificationKind): string {
  switch (kind) {
    case NotificationKind.GradingRequestAccepted:
      return 'grading_request_accepted';
    case NotificationKind.GradingRequestDeclined:
      return 'grading_request_declined';
    case NotificationKind.GradingRequestsYouAsInstructor:
      return 'grading_request_instructor';
    case NotificationKind.GradingManagerAdded:
      return 'grading_manager_added';
    case NotificationKind.GradingManagerRemoved:
      return 'grading_manager_removed';
    case NotificationKind.GradingPurchased:
      return 'grading_purchased';
    case NotificationKind.GradingPassed:
      return 'grading_passed';
    case NotificationKind.GradingNotPassed:
      return 'grading_not_passed';
    case NotificationKind.GradingNeedsEventDate:
      return 'grading_needs_event_date';
    case NotificationKind.GradingUnpaid:
      return 'grading_unpaid';
    default:
      return toSnakeCase(kind);
  }
}

/**
 * Generates a deterministic, entity-derived document ID for a notification.
 *
 * Rules:
 * 1. Dependent entity docId comes first, separated by underscores.
 * 2. Orders: ${orderDocId}_${purpose}
 * 3. Events: ${eventDocId}_${orderDocId || 'reg'}_event_reg or ${eventDocId}_${purpose}
 * 4. Gradings: ${gradingDocId}_${serverTimestamp}_${stage}
 * 5. VOD: ${targetId}_${purpose}
 * 6. Uploads: ${uploadDocId}_upload
 * 7. Member profile transitions without an order: ${newDocId}_${snake_case_kind}
 */
export function generateBackendNotificationDocId(
  notification:
    | (Omit<MemberNotification, 'docId'> & { docId?: string })
    | {
        kind: NotificationKind;
        data?: Record<string, unknown>;
        createdAt?: string;
        docId?: string;
        markdown?: string;
        dismissed?: boolean;
      },
  newDocId: string,
): string {
  if (notification.docId) {
    return notification.docId;
  }

  const kind = notification.kind;
  const data = (notification.data || {}) as Record<string, unknown>;
  const createdAt = notification.createdAt || new Date().toISOString();
  const safeTimestamp = createdAt.replace(/[:.]/g, '-');

  // 1. Order-connected notifications
  const orderDocId = (data['orderDocId'] || data['orderId']) as
    | string
    | undefined;
  if (orderDocId) {
    switch (kind) {
      case NotificationKind.PurchaseFulfilled:
        return `${orderDocId}_purchase_fulfilled`;
      case NotificationKind.MembershipPending:
        return `${orderDocId}_membership_pending`;
      case NotificationKind.InstructorLicensePending:
        return `${orderDocId}_license_pending`;
      case NotificationKind.OrderNeedsAttention:
        return `${orderDocId}_order_issue`;
      case NotificationKind.ManualOrderFulfilled:
        return `${orderDocId}_manual_order_fulfilled`;
    }
  }

  // 2. Event-connected notifications
  const eventDocId = (data['eventId'] || data['eventDocId']) as
    | string
    | undefined;
  if (eventDocId) {
    switch (kind) {
      case NotificationKind.EventRegistrationConfirmed:
        return orderDocId
          ? `${eventDocId}_${orderDocId}_event_reg`
          : `${eventDocId}_event_reg`;
      case NotificationKind.EventVideoAvailable:
        return `${eventDocId}_event_video`;
      case NotificationKind.EventProposalSubmitted:
        return `${eventDocId}_event_proposal_submitted`;
      case NotificationKind.NewEventPosted:
        return `${eventDocId}_new_event_posted`;
      case NotificationKind.PendingEventApproval:
        return `${eventDocId}_pending_event`;
    }
  }

  // 3. Grading-connected notifications
  const gradingDocId = data['gradingDocId'] as string | undefined;
  if (gradingDocId) {
    const stage = gradingStageFromKind(kind);
    return `${gradingDocId}_${safeTimestamp}_${stage}`;
  }

  // 4. Video-on-Demand notifications
  const videoTargetId = (data['videoId'] || data['seriesId']) as
    | string
    | undefined;
  if (videoTargetId) {
    switch (kind) {
      case NotificationKind.VideoAccessGranted:
        return `${videoTargetId}_video_access_granted`;
      case NotificationKind.VideoGiftReceived:
        return `${videoTargetId}_video_gift_received`;
    }
  }

  // 5. Upload notifications
  const uploadDocId = data['uploadDocId'] as string | undefined;
  if (uploadDocId && kind === NotificationKind.NewUpload) {
    return `${uploadDocId}_upload`;
  }

  // 6. Member Profile Transitions & Default Fallback:
  // Postfix with notification type string: e.g. ${newDocId}_membership_activated
  return `${newDocId}_${toSnakeCase(kind)}`;
}

/**
 * Creates a notification document in the member's notifications subcollection.
 * Uses deterministic document IDs to guarantee idempotent writes without
 * race conditions.
 */
export async function createMemberNotification(
  db: admin.firestore.Firestore,
  memberDocId: string,
  notification: Omit<MemberNotification, 'docId'>,
): Promise<void> {
  const notifications = db
    .collection('members')
    .doc(memberDocId)
    .collection('notifications');

  const newDocId = notifications.doc().id || `notif_${Date.now()}`;
  const docId = generateBackendNotificationDocId(notification, newDocId);
  const ref = notifications.doc(docId);
  await ref.set({ ...notification, docId: ref.id } as MemberNotification);
}

