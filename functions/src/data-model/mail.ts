/* mail.ts
 *
 * Domain models for the Firestore `/mail` outbound collection.
 * Tracks message payloads, lifecycle status ('PENDING' -> 'PROCESSING' -> 'SUCCESS' | 'ERROR'),
 * delivery attempt metrics, and error traces.
 */

export enum MailDeliveryState {
  Pending = 'PENDING',
  Processing = 'PROCESSING',
  Success = 'SUCCESS',
  Error = 'ERROR',
  Paused = 'PAUSED',
}

export interface MailDeliveryInfo {
  state?: MailDeliveryState;
  startTime?: unknown;
  endTime?: unknown;
  attempts?: number;
  error?: string | null;
  info?: {
    messageId?: string;
    response?: string;
    simulated?: boolean;
    reason?: string;
  };
  retryRequestedAt?: unknown;
  retryRequestedBy?: string;
}

export interface MailMessage {
  subject?: string;
  text?: string;
  html?: string;
}

export interface MailMetadata {
  sentAt?: string;
  templateKey?: string;
  requestedBy?: string;
  frequency?: string;
  orderNumber?: string;
  adminTest?: boolean;
  paused?: boolean;
  queuedAt?: string;
  [key: string]: unknown;
}

export enum TransactionalEmailKey {
  MembershipActivated = 'membershipActivated',
  InstructorLicenseActivated = 'instructorLicenseActivated',
  OrderConfirmation = 'orderConfirmation',
  EventRegistrationConfirmation = 'eventRegistrationConfirmation',
  VodPurchaseConfirmation = 'vodPurchaseConfirmation',
  VodGiftReceived = 'vodGiftReceived',
  GradingPaymentConfirmation = 'gradingPaymentConfirmation',
  SubscriptionRenewal = 'subscriptionRenewal',
  EventDigestOverall = 'eventDigestOverall',
  // Grading workflow emails
  GradingRequestReceived = 'gradingRequestReceived',
  GradingRequestAccepted = 'gradingRequestAccepted',
  GradingRequestDeclined = 'gradingRequestDeclined',
  GradingPassed = 'gradingPassed',
  GradingNotPassed = 'gradingNotPassed',
}

export interface MailQueueDoc {
  docId?: string;
  to: string | string[];
  from?: string;
  replyTo?: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  message?: MailMessage;
  status?: MailDeliveryState;
  delivery?: MailDeliveryInfo;
  metadata?: MailMetadata;
  templateKey?: string;
  templateData?: Record<string, string>;
  createdAt?: unknown;
}

/**
 * Returns a clean, default MailQueueDoc object.
 */
export function initMailDoc(): MailQueueDoc {
  return {
    to: [],
    from: '',
    replyTo: '',
    status: MailDeliveryState.Pending,
    delivery: {
      state: MailDeliveryState.Pending,
      attempts: 0,
      error: null,
    },
    message: {
      subject: '',
      text: '',
      html: '',
    },
  };
}

export const ALL_TRANSACTIONAL_EMAIL_KEYS: TransactionalEmailKey[] = [
  TransactionalEmailKey.MembershipActivated,
  TransactionalEmailKey.InstructorLicenseActivated,
  TransactionalEmailKey.OrderConfirmation,
  TransactionalEmailKey.EventRegistrationConfirmation,
  TransactionalEmailKey.VodPurchaseConfirmation,
  TransactionalEmailKey.VodGiftReceived,
  TransactionalEmailKey.GradingPaymentConfirmation,
  TransactionalEmailKey.SubscriptionRenewal,
  TransactionalEmailKey.EventDigestOverall,
  TransactionalEmailKey.GradingRequestReceived,
  TransactionalEmailKey.GradingRequestAccepted,
  TransactionalEmailKey.GradingRequestDeclined,
  TransactionalEmailKey.GradingPassed,
  TransactionalEmailKey.GradingNotPassed,
];

export enum MailSendingStatus {
  Active = 'active',
  Paused = 'paused',
  Off = 'off',
}

/**
 * Global system settings for outbound mail dispatch, stored at /system/mail-settings.
 */
export interface MailSettings {
  status: MailSendingStatus;
  notificationStatus?: Partial<Record<TransactionalEmailKey, MailSendingStatus>>;
  sendingPaused?: boolean;
  unsubscribeSecret?: string;
  updatedAt?: string;
  updatedBy?: string;
  pausedAt?: string;
  pausedBy?: string;
  resumedAt?: string;
  resumedBy?: string;
}

export function initMailSettings(): MailSettings {
  return {
    status: MailSendingStatus.Off,
    sendingPaused: false,
    notificationStatus: {},
  };
}

/**
 * Resolves the operational mail sending status for a given templateKey.
 * Checks fine-grained notificationStatus first, then falls back to global status,
 * and finally defaults to Off.
 */
export function resolveNotificationStatus(
  settings: MailSettings | undefined,
  templateKey?: TransactionalEmailKey | string,
): MailSendingStatus {
  if (!settings) {
    return MailSendingStatus.Off;
  }
  if (templateKey && settings.notificationStatus && (templateKey in settings.notificationStatus)) {
    const specific = settings.notificationStatus[templateKey as TransactionalEmailKey];
    if (specific) {
      return specific;
    }
  }
  if (settings.status) {
    return settings.status;
  }
  return settings.sendingPaused ? MailSendingStatus.Paused : MailSendingStatus.Off;
}

export interface DeleteMailItemsRequest {
  mailIds: string[];
}

export interface DeleteMailItemsResponse {
  success: boolean;
  deletedCount: number;
  skippedCount: number;
  skippedProcessingIds: string[];
}

export interface UpdateMailItemRequest {
  mailId: string;
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  templateData?: Record<string, string>;
  status?: MailDeliveryState;
}

export interface UpdateMailItemResponse {
  success: boolean;
  docId: string;
}

