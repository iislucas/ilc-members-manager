import { GenericFsDoc } from './base';
import { OrderStatus } from './orders';

export enum NotificationKind {
  GradingRequestAccepted = 'GradingRequestAccepted',
  GradingRequestDeclined = 'GradingRequestDeclined',
  GradingRequestsYouAsInstructor = 'GradingRequestsYouAsInstructor',
  // Sent to someone who has become a manager of a grading (the primary grading
  // instructor or grading managers, or the organizer/managers of an event the
  // grading is linked to). The string values are kept as 'GradingInstructorAdded'/'...Removed'
  // for backward compatibility with already-stored notifications and per-kind
  // notification settings.
  GradingManagerAdded = 'GradingInstructorAdded',
  GradingManagerRemoved = 'GradingInstructorRemoved',
  // Sent to the student when a grading is purchased, guiding them to the next
  // step (e.g. choosing an instructor) for that grading.
  GradingPurchased = 'GradingPurchased',
  // Sent to the student when a grading result is recorded.
  GradingPassed = 'GradingPassed',
  GradingNotPassed = 'GradingNotPassed',
  // Sent to whoever tried to record a grading result without the grading event
  // date set. The result is reverted until the date is filled in, since the date
  // is part of the grading's reference (see `gradingDisplayId`).
  GradingNeedsEventDate = 'GradingNeedsEventDate',
  // A TODO surfaced (client-driven, on login) when a grading is completed
  // (passed/not-passed) but not yet paid. Shown to the student and to the
  // instructors responsible for that student's grading.
  GradingUnpaid = 'GradingUnpaid',
  // Sent to a member when one of their purchases (membership, license, video
  // library, grading, etc.) has been processed/fulfilled.
  PurchaseFulfilled = 'PurchaseFulfilled',
  // BlogPost covers all types of blog posts (including Members Area Blog, Instructors Blog,
  // and Zoom Classes which are cached as blog posts). Instead of individual kinds,
  // a BlogPost notification specifies the collection query path (blogPath), optional
  // category/tag filter (blogCategory), and a date cut-off (lastSeenDateStr) so the client
  // can determine what new posts/classes are available to catch up on.
  BlogPost = 'BlogPost',
  NewEventPosted = 'NewEventPosted',
  // Sent to the owner, managers and leading instructor of a member-proposed event
  // when it is first submitted (status='proposed'), letting the whole organising
  // team know the listing request is in.
  EventProposalSubmitted = 'EventProposalSubmitted',
  // Admin-only: a member-proposed event is waiting for approval (status='proposed').
  // Surfaced to admins so they can review and approve/reject it from Manage Events.
  PendingEventApproval = 'PendingEventApproval',
  // Admin-only: an order failed automatic processing (ilcAppOrderStatus 'error' or
  // 'needs-manual-processing') and needs an admin to resolve it from the order view.
  OrderNeedsAttention = 'OrderNeedsAttention',
  // Admin-only: an order that needed manual processing has been fulfilled.
  ManualOrderFulfilled = 'ManualOrderFulfilled',
  // Sent to a student when their primary instructor removes them from their
  // student list (which clears the student's primaryInstructorId). Informational
  // rather than an action: picking a new primary instructor is entirely optional
  // and in practice is not something the student is expected to act on here.
  PrimaryInstructorRemoved = 'PrimaryInstructorRemoved',
  // Sent to a student when their primary instructor records their lapsed
  // membership as Inactive. Informational: renewing is always an option, but
  // nothing is being asked of them here.
  MembershipMarkedInactive = 'MembershipMarkedInactive',
  MembershipPending = 'MembershipPending',
  MembershipActivated = 'MembershipActivated',
  InstructorLicensePending = 'InstructorLicensePending',
  InstructorLicenseActivated = 'InstructorLicenseActivated',
  // Admin-only: a member/instructor uploaded a new material (video/photo/file).
  NewUpload = 'NewUpload',
  // Admin-only: summary notification when multiple new uploads arrived in a batch.
  NewUploadsSummary = 'NewUploadsSummary',
  // Summary notification when multiple new blog posts arrived in a batch.
  BlogPostsSummary = 'BlogPostsSummary',
  // Admin-only: summary notification when multiple proposed events are waiting for approval.
  PendingEventsSummary = 'PendingEventsSummary',
  // Admin-only: summary notification when multiple orders need manual attention.
  OrderIssuesSummary = 'OrderIssuesSummary',
  // Summary notification when multiple completed gradings are unpaid.
  UnpaidGradingsSummary = 'UnpaidGradingsSummary',
  // Sent to an event attendee upon successful registration and payment, containing Zoom joining links if online.
  EventRegistrationConfirmed = 'EventRegistrationConfirmed',
  // Sent to paid event attendees when the recording for the event becomes available.
  EventVideoAvailable = 'EventVideoAvailable',
}

// Two presentation styles for notifications: an 'action' has an expectation/TODO
// for the recipient; an 'info' is something for them to know.
export enum NotificationStyle {
  Action = 'action',
  Info = 'info',
}

// The kinds that carry a TODO/expectation for the recipient. Everything not
// listed here is informational. Derived from the kind so it applies retroactively
// to already-stored notifications without a schema change.
const ACTION_NOTIFICATION_KINDS: ReadonlySet<NotificationKind> = new Set([
  NotificationKind.GradingRequestDeclined,
  NotificationKind.GradingRequestsYouAsInstructor,
  NotificationKind.GradingManagerAdded,
  NotificationKind.GradingPurchased,
  NotificationKind.GradingUnpaid,
  NotificationKind.GradingNeedsEventDate,
  NotificationKind.UnpaidGradingsSummary,
  NotificationKind.PendingEventApproval,
  NotificationKind.PendingEventsSummary,
  NotificationKind.OrderNeedsAttention,
  NotificationKind.OrderIssuesSummary,
  NotificationKind.InstructorLicenseActivated,
]);

export function notificationStyle(kind: NotificationKind): NotificationStyle {
  return ACTION_NOTIFICATION_KINDS.has(kind) ? NotificationStyle.Action : NotificationStyle.Info;
}

export interface MemberNotificationCommon {
  docId: string;
  markdown: string;
  createdAt: string; // ISO string
  dismissed: boolean;
}

export interface NotificationGradingData {
  gradingDocId: string;
  level: string;
}

export interface NotificationInstructorGradingData {
  gradingDocId: string;
  studentName: string;
  level: string;
  // When the manager role came from an event the grading is linked to, these
  // carry the event context for the message/link. Absent for instructor-role
  // additions not tied to an event.
  eventDocId?: string;
  eventTitle?: string;
}

export interface NotificationBlogPostData {
  // The Firestore collection the post lives in, e.g. 'members-post' or
  // 'instructors-post'. Doubles as the per-blog "feed" key when finding the
  // last post the member has already been notified about.
  blogPath: string;
  blogCategory: string;
  // ISO date string of the post this notification is about (its publishOn).
  // The most recent value across a member's BlogPost notifications acts as the
  // cut-off for deciding which newer posts still need a notification.
  lastSeenDateStr: string;
  // Identifies the specific post, used for linking and de-duplication so the
  // same post is never surfaced twice. Optional for backwards compatibility.
  blogPostId?: string;
  blogPostUrlId?: string;
}

export interface NotificationEventData {
  eventId: string;
  title: string;
}

export interface NotificationEventProposalData {
  // Firestore doc ID of the proposed event. Intentionally named `eventDocId`
  // (not `eventId`) so this notification is NOT caught by the `eventId`
  // de-duplication in notifications.ts — the later "now listed publicly"
  // notification (NewEventPosted, keyed on `eventId`) must not clobber it.
  eventDocId: string;
  title: string;
  // Display name of the member who submitted the listing request.
  submitterName: string;
}

export interface NotificationPurchaseData {
  // The human-readable order number (or order doc ID) this notification is
  // about; used for de-duplication so an order is only announced once.
  orderId: string;
  // A short human-readable summary of what was purchased, e.g.
  // "Annual Membership, Video Library Access".
  summary: string;
}

export interface NotificationOrderIssueData {
  // Firestore doc ID of the order; used both to deep-link to the order view and
  // to de-duplicate so the same order is only announced once per admin.
  orderDocId: string;
  // Human-readable order reference (Squarespace orderNumber or Sheets
  // referenceNumber) for display.
  orderRef: string;
  // The processing status that flagged this order ('error' or
  // 'needs-manual-processing').
  status: OrderStatus;
  // The recorded processing issues (ilcAppOrderIssues), if any.
  issues: string[];
}

export interface NotificationMembershipActivatedData {
  orderId?: string;
}

export interface NotificationInstructorLicenseActivatedData {
  orderId?: string;
  instructorId?: string;
}

export interface NotificationPrimaryInstructorRemovedData {
  // The instructor who removed the student, as they were listed on the
  // student's profile before the removal.
  instructorId: string;
  instructorName: string;
}

export interface NotificationMembershipMarkedInactiveData {
  // The primary instructor who recorded the membership as inactive.
  instructorId: string;
  instructorName: string;
}

export interface NotificationUploadData {
  // Firestore doc ID of the upload item in /members/{memberDocId}/uploads/{uploadDocId}
  uploadDocId: string;
  memberDocId: string;
  uploadName: string;
  uploaderName?: string;
  uploaderMemberId?: string;
  uploadCreatedAt?: string;
  eventDocId?: string;
  eventTitle?: string;
}

export interface NotificationUploadsSummaryData {
  count: number;
  startDate: string;
  endDate: string;
  lastSeenDateStr?: string;
}

export interface NotificationBlogPostsSummaryData {
  count: number;
  feedLabel: string;
  feedCollection: string;
  areaRoute: string;
  lastSeenDateStr?: string;
}

export interface NotificationPendingEventsSummaryData {
  count: number;
}

export interface NotificationOrderIssuesSummaryData {
  count: number;
}

export interface NotificationUnpaidGradingsSummaryData {
  count: number;
  isStudent?: boolean;
}

export interface NotificationEventRegistrationConfirmedData {
  orderDocId?: string;
  eventId: string;
  attendance?: string;
  onlineJoiningLink?: string;
  purchaseDetailsMarkdown?: string;
  inPersonDetailsMarkdown?: string;
}

export interface NotificationEventVideoAvailableData {
  eventId: string;
  videoId?: string;
  videoUrl?: string;
}

export type MemberNotification = MemberNotificationCommon & (
  | {
    kind: NotificationKind.GradingRequestAccepted;
    data: NotificationGradingData;
  }
  | {
    kind: NotificationKind.GradingRequestDeclined;
    data: NotificationGradingData;
  }
  | {
    kind: NotificationKind.GradingRequestsYouAsInstructor;
    data: NotificationInstructorGradingData;
  }
  | {
    kind: NotificationKind.GradingManagerAdded;
    data: NotificationInstructorGradingData;
  }
  | {
    kind: NotificationKind.GradingManagerRemoved;
    data: NotificationInstructorGradingData;
  }
  | {
    kind: NotificationKind.GradingPurchased;
    data: NotificationGradingData;
  }
  | {
    kind: NotificationKind.GradingPassed;
    data: NotificationGradingData;
  }
  | {
    kind: NotificationKind.GradingNeedsEventDate;
    data: NotificationGradingData;
  }
  | {
    kind: NotificationKind.GradingNotPassed;
    data: NotificationGradingData;
  }
  | {
    kind: NotificationKind.GradingUnpaid;
    data: NotificationGradingData;
  }
  | {
    kind: NotificationKind.BlogPost;
    data: NotificationBlogPostData;
  }
  | {
    kind: NotificationKind.NewEventPosted;
    data: NotificationEventData;
  }
  | {
    kind: NotificationKind.EventProposalSubmitted;
    data: NotificationEventProposalData;
  }
  | {
    kind: NotificationKind.PendingEventApproval;
    data: NotificationEventData;
  }
  | {
    kind: NotificationKind.OrderNeedsAttention;
    data: NotificationOrderIssueData;
  }
  | {
    kind: NotificationKind.ManualOrderFulfilled;
    data: NotificationOrderIssueData;
  }
  | {
    kind: NotificationKind.PurchaseFulfilled;
    data: NotificationPurchaseData;
  }
  | {
    kind: NotificationKind.MembershipPending;
    data: NotificationPurchaseData;
  }
  | {
    kind: NotificationKind.MembershipActivated;
    data: NotificationMembershipActivatedData;
  }
  | {
    kind: NotificationKind.InstructorLicensePending;
    data: NotificationPurchaseData;
  }
  | {
    kind: NotificationKind.InstructorLicenseActivated;
    data: NotificationInstructorLicenseActivatedData;
  }
  | {
    kind: NotificationKind.PrimaryInstructorRemoved;
    data: NotificationPrimaryInstructorRemovedData;
  }
  | {
    kind: NotificationKind.MembershipMarkedInactive;
    data: NotificationMembershipMarkedInactiveData;
  }
  | {
    kind: NotificationKind.NewUpload;
    data: NotificationUploadData;
  }
  | {
    kind: NotificationKind.NewUploadsSummary;
    data: NotificationUploadsSummaryData;
  }
  | {
    kind: NotificationKind.BlogPostsSummary;
    data: NotificationBlogPostsSummaryData;
  }
  | {
    kind: NotificationKind.PendingEventsSummary;
    data: NotificationPendingEventsSummaryData;
  }
  | {
    kind: NotificationKind.OrderIssuesSummary;
    data: NotificationOrderIssuesSummaryData;
  }
  | {
    kind: NotificationKind.UnpaidGradingsSummary;
    data: NotificationUnpaidGradingsSummaryData;
  }
  | {
    kind: NotificationKind.EventRegistrationConfirmed;
    data: NotificationEventRegistrationConfirmedData;
  }
  | {
    kind: NotificationKind.EventVideoAvailable;
    data: NotificationEventVideoAvailableData;
  }
);

export interface MemberNotificationSettings {
  pushEnabled: { [kind in NotificationKind]?: boolean };
  homeEnabled: { [kind in NotificationKind]?: boolean };
  globalPushEnabled?: boolean;
}

export type MemberNotificationFsDoc = Omit<MemberNotification, 'docId'>;

export function initMemberNotification(): MemberNotification {
  return {
    docId: '',
    markdown: '',
    createdAt: new Date().toISOString(),
    dismissed: false,
    kind: NotificationKind.GradingPurchased,
    data: {
      gradingDocId: '',
      level: '',
    },
  };
}

export function firestoreDocToMemberNotification(doc: GenericFsDoc): MemberNotification {
  const docData = (doc.data() || {}) as Partial<MemberNotificationFsDoc>;
  return {
    ...initMemberNotification(),
    ...docData,
    docId: doc.id,
  } as MemberNotification;
}
