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
  };
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

