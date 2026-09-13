/* mail.ts
 *
 * Domain models for the Firestore `/mail` outbound collection.
 * Tracks message payloads, lifecycle status ('PENDING' -> 'PROCESSING' -> 'SUCCESS' | 'ERROR'),
 * delivery attempt metrics, and error traces.
 */

export type MailDeliveryState = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

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
  [key: string]: unknown;
}

export interface MailQueueDoc {
  docId?: string;
  to: string | string[];
  from?: string;
  replyTo?: string;
  subject?: string;
  text?: string;
  html?: string;
  message?: MailMessage;
  status?: MailDeliveryState;
  delivery?: MailDeliveryInfo;
  metadata?: MailMetadata;
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
    status: 'PENDING',
    delivery: {
      state: 'PENDING',
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
