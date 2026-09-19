import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import nodemailer, { type Transporter, type SentMessageInfo, type SendMailOptions } from 'nodemailer';
import { environment } from './environment/environment';
import { assertAdmin, allowedOrigins } from './common';
import { markdownToHtml, formatTemplate } from './email-markdown';
import { FirestoreCollection } from './data-model/collections';
import {
  MailQueueDoc,
  MailDeliveryState,
  MailSettings,
  MailSendingStatus,
  DeleteMailItemsRequest,
  DeleteMailItemsResponse,
  UpdateMailItemRequest,
  UpdateMailItemResponse,
  TransactionalEmailKey,
  ALL_TRANSACTIONAL_EMAIL_KEYS,
  resolveNotificationStatus,
  initMailSettings,
} from './data-model/mail';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';

export {
  MailQueueDoc,
  MailDeliveryState,
  MailSettings,
  MailSendingStatus,
  DeleteMailItemsRequest,
  DeleteMailItemsResponse,
  UpdateMailItemRequest,
  UpdateMailItemResponse,
  TransactionalEmailKey,
  ALL_TRANSACTIONAL_EMAIL_KEYS,
  resolveNotificationStatus,
};
export const smtpPassword = defineSecret('SMTP_PASSWORD');

/**
 * Helper to dispatch an email via a nodemailer Transporter.
 */
export async function sendSmtpEmail(
  transporter: Transporter,
  doc: MailQueueDoc,
  defaultFromName: string,
): Promise<SentMessageInfo> {
  const fromAddress = doc.from || environment.email?.from;
  if (!fromAddress) {
    throw new Error('No sender "from" address specified in mail document or environment.email.from');
  }
  const fromName = environment.email?.fromName || defaultFromName;
  const replyTo = doc.replyTo || environment.email?.contact || fromAddress;
  const subject = doc.message?.subject || doc.subject || '(No Subject)';
  const text = doc.message?.text || doc.text || '';
  const html = doc.message?.html || doc.html || '';
  const to = Array.isArray(doc.to) ? doc.to.join(', ') : doc.to;

  const mailOptions: SendMailOptions = {
    from: `"${fromName}" <${fromAddress}>`,
    to,
    replyTo,
    subject,
    text,
    html,
  };

  if (doc.headers) {
    mailOptions.headers = doc.headers;
  }

  return await transporter.sendMail(mailOptions);
}

/**
 * Validates global sending status and document fields.
 * Records early errors if recipient or from address is missing.
 */
export async function checkMailSendability(
  db: admin.firestore.Firestore,
  data: MailQueueDoc,
  mailId: string,
  ref: admin.firestore.DocumentReference,
): Promise<{ canSend: boolean; recipients?: string }> {
  const mailSettingsSnap = await db.doc('system/mail-settings').get();
  const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
  const templateKey = data.templateKey;
  const status: MailSendingStatus = resolveNotificationStatus(mailSettings, templateKey);

  if (!data.metadata?.adminTest) {
    if (status === MailSendingStatus.Off) {
      logger.info(`[MailProcessor] Mail sending is OFF for template ${templateKey || 'unknown'}. Skipping document ${mailId}.`);
      return { canSend: false };
    }
    if (status === MailSendingStatus.Paused) {
      logger.info(`[MailProcessor] Mail sending is PAUSED for template ${templateKey || 'unknown'}. Setting document ${mailId} to PAUSED.`);
      await ref.update({
        status: MailDeliveryState.Paused,
        'delivery.state': MailDeliveryState.Paused,
      });
      return { canSend: false };
    }
  }

  const recipients = Array.isArray(data.to) ? data.to.join(', ') : data.to;
  if (!recipients) {
    logger.warn(`[MailProcessor] Mail document ${mailId} has no recipient. Skipping.`);
    await ref.update({
      status: MailDeliveryState.Error,
      'delivery.state': MailDeliveryState.Error,
      'delivery.error': 'No recipient specified in mail document',
      'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
    });
    return { canSend: false };
  }

  const fromAddress = data.from || environment.email?.from;
  if (!fromAddress) {
    logger.error(
      `[MailProcessor] Mail document ${mailId} has no "from" address and environment.email.from is not set.`,
    );
    await ref.update({
      status: MailDeliveryState.Error,
      'delivery.state': MailDeliveryState.Error,
      'delivery.error': 'No sender "from" address specified in mail document or environment.email.from',
      'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
    });
    return { canSend: false };
  }

  return { canSend: true, recipients };
}

/**
 * Atomically locks the mail document in Firestore transitioning status from PENDING to PROCESSING.
 */
export async function acquireMailLock(
  db: admin.firestore.Firestore,
  docRef: admin.firestore.DocumentReference,
  mailId: string,
): Promise<boolean> {
  try {
    return await db.runTransaction(async (tx) => {
      const curDoc = await tx.get(docRef);
      if (!curDoc.exists) return false;
      const curData = curDoc.data() as MailQueueDoc;
      const curState = curData.status || curData.delivery?.state || MailDeliveryState.Pending;
      if (curState !== MailDeliveryState.Pending) {
        return false;
      }
      tx.update(docRef, {
        status: MailDeliveryState.Processing,
        'delivery.state': MailDeliveryState.Processing,
        'delivery.startTime': admin.firestore.FieldValue.serverTimestamp(),
        'delivery.attempts': admin.firestore.FieldValue.increment(1),
      });
      return true;
    });
  } catch (txErr) {
    logger.warn(`[MailProcessor] Lock transaction failed for mailId ${mailId}:`, txErr);
    return false;
  }
}

/**
 * If the document specifies a templateKey and templateData, dynamically re-renders the latest
 * templates from /system/email-templates so any edits made while queued take immediate effect.
 */
export async function renderQueuedMailTemplate(
  db: admin.firestore.Firestore,
  docRef: admin.firestore.DocumentReference,
  data: MailQueueDoc,
  mailId: string,
): Promise<void> {
  if (!data.templateKey || !data.templateData) return;

  try {
    const templateSnap = await db.doc('system/email-templates').get();
    const customTemplates = templateSnap.exists ? (templateSnap.data() as Partial<EmailTemplates>) : {};
    const defaults = initEmailTemplates();

    const subjectKey = `${data.templateKey}Subject` as keyof EmailTemplates;
    const bodyKey = `${data.templateKey}Body` as keyof EmailTemplates;

    const subjectTemplate = customTemplates[subjectKey] || defaults[subjectKey] || '';
    const bodyTemplate = customTemplates[bodyKey] || defaults[bodyKey] || '';

    if (subjectTemplate || bodyTemplate) {
      const renderedSubject = formatTemplate(subjectTemplate, data.templateData);
      const renderedMarkdown = formatTemplate(bodyTemplate, data.templateData);
      const renderedHtml = markdownToHtml(renderedMarkdown);

      data.message = {
        subject: renderedSubject,
        text: renderedMarkdown,
        html: renderedHtml,
      };

      await docRef.update({
        message: data.message,
      });
    }
  } catch (renderErr) {
    logger.warn(`[MailProcessor] Failed to dynamically render template for ${mailId}:`, renderErr);
  }
}

/**
 * Dispatches the email over SMTP (or simulates delivery in emulator / missing secret mode)
 * and records the resulting delivery outcome.
 */
export async function dispatchAndRecordDelivery(
  docRef: admin.firestore.DocumentReference,
  data: MailQueueDoc,
  mailId: string,
  recipients: string,
  password: string,
): Promise<void> {
  const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

  if (isEmulator || !password) {
    logger.info(
      `[MailProcessor] Simulating delivery for mailId ${mailId} to [${recipients}] (${
        !password ? 'No SMTP_PASSWORD secret configured' : 'Running in local emulator'
      }).`,
    );
    await docRef.update({
      status: MailDeliveryState.Success,
      'delivery.state': MailDeliveryState.Success,
      'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
      'delivery.info': {
        simulated: true,
        reason: !password ? 'No SMTP_PASSWORD secret set' : 'Emulator mode',
      },
    });
    return;
  }

  const host = environment.email?.smtpHost || 'smtp-relay.gmail.com';
  const port = environment.email?.smtpPort || 465;
  const user = environment.email?.smtpUser || environment.email?.from || data.from || '';
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass: password.replace(/\s+/g, ''),
    },
  });

  try {
    const info = await sendSmtpEmail(transporter, data, 'I Liq Chuan Association');

    logger.info(
      `[MailProcessor] Successfully sent email ${mailId} to [${recipients}]: messageId=${info.messageId}`,
    );

    await docRef.update({
      status: MailDeliveryState.Success,
      'delivery.state': MailDeliveryState.Success,
      'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
      'delivery.info': {
        messageId: info.messageId,
        response: info.response,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[MailProcessor] Failed to deliver email ${mailId} to [${recipients}]:`, err);
    await docRef.update({
      status: MailDeliveryState.Error,
      'delivery.state': MailDeliveryState.Error,
      'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
      'delivery.error': errorMsg,
    });
  }
}

/**
 * Cloud Function that processes task documents in the `/mail` collection.
 * Replaces the heavy Firebase "Trigger Email" extension with a simple, secure,
 * native Cloud Function that authenticates with the SMTP_PASSWORD secret.
 */
export const processMailQueue = onDocumentWritten(
  {
    document: 'mail/{mailId}',
    secrets: [smtpPassword],
  },
  async (event) => {
    const snap = event.data?.after;
    if (!snap || !snap.exists) return;

    const data = snap.data() as MailQueueDoc | undefined;
    if (!data) return;

    const mailId = event.params.mailId;

    // Fast guard: ONLY process emails that are explicitly 'PENDING'.
    const effectiveState = data.status || data.delivery?.state || MailDeliveryState.Pending;
    if (effectiveState !== MailDeliveryState.Pending) {
      return;
    }

    const db = admin.firestore();
    const { canSend, recipients } = await checkMailSendability(db, data, mailId, snap.ref);
    if (!canSend || !recipients) {
      return;
    }

    const locked = await acquireMailLock(db, snap.ref, mailId);
    if (!locked) {
      logger.info(`[MailProcessor] Document ${mailId} is already locked or completed. Skipping.`);
      return;
    }

    await renderQueuedMailTemplate(db, snap.ref, data, mailId);

    let password = '';
    try {
      password = smtpPassword.value() || '';
    } catch {
      password = '';
    }

    await dispatchAndRecordDelivery(snap.ref, data, mailId, recipients, password);
  },
);

export interface SendAdminTestEmailRequest {
  to: string;
  subject: string;
  bodyMarkdown: string;
  fromName?: string;
  replyTo?: string;
  name?: string;
  replacements?: Record<string, string>;
}

export interface SendAdminTestEmailResponse {
  success: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
  docId?: string;
}

/**
 * Admin-only callable Cloud Function to safely send a test email.
 * Validates admin credentials via assertAdmin, sends or simulates dispatch,
 * logs the record in Firestore /mail, and returns immediate status.
 */
export const sendAdminTestEmail = onCall(
  {
    cors: allowedOrigins,
  },
  async (request): Promise<SendAdminTestEmailResponse> => {
    logger.info('[MailProcessor] sendAdminTestEmail called');
    await assertAdmin(request);

    const data = request.data as SendAdminTestEmailRequest | undefined;
    if (!data || !data.to || !data.subject || !data.bodyMarkdown) {
      throw new HttpsError(
        'invalid-argument',
        'Recipient (to), subject, and bodyMarkdown are all required.',
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.to.trim())) {
      throw new HttpsError('invalid-argument', `Invalid recipient email address: "${data.to}"`);
    }

    const fromAddress = environment.email?.from;
    if (!fromAddress) {
      throw new HttpsError(
        'failed-precondition',
        'No sender "from" address configured in environment.email.from',
      );
    }

    const recipient = data.to.trim();
    const origin = environment.links?.appBase || 'https://app.iliqchuan.com';
    const defaultReplacements: Record<string, string> = {
      name: data.name || request.auth?.token.name || 'Test Member',
      email: recipient,
      memberId: 'US123',
      instructorId: '101',
      appBase: origin,
      instructorSopUrl: `${origin}/instructors-area/sop`,
      orderNumber: '1001',
      orderDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      amount: '$120.00',
      currency: 'USD',
      itemsSummary: '- 1x Annual Membership Renewal ($120.00)',
      receiptUrl: `${origin}/orders/1001`,
      eventTitle: 'Zhong Xin Dao Summer Retreat',
      eventDates: 'July 15 - July 20, 2026',
      eventLocation: 'Fishkill, NY, USA',
      attendanceType: 'In-Person & Online',
      onlineJoiningLink: 'https://zoom.us/j/123456789',
      specialInstructions: 'Please arrive 15 minutes prior to the first session.',
      videoTitle: '21 Form Detailed Breakdown',
      videoUrl: `${origin}/videos/v-21-form`,
      gradingLevel: 'Student Level 3',
      gradingEventName: 'Annual International Grading Examination',
      gradingDate: 'October 12, 2026',
      gradingUrl: `${origin}/gradings`,
      planName: 'Annual Instructor Association Membership',
      renewalDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      nextRenewalDate: 'Next billing cycle',
      period: 'the next 3 months',
      eventsCount: '2',
      calendarUrl: `${origin}/events`,
      preferencesUrl: `${origin}/settings/notifications`,
      ...(data.replacements || {}),
    };

    const subject = formatTemplate(data.subject.trim(), defaultReplacements);
    const bodyMarkdown = formatTemplate(data.bodyMarkdown.trim(), defaultReplacements);
    const html = markdownToHtml(bodyMarkdown);
    const db = admin.firestore();

    // Enqueue document into `/mail` using the exact same code pathway as transactional emails
    const mailDocRef = await db.collection(FirestoreCollection.Mail).add({
      to: [recipient],
      from: fromAddress,
      replyTo: data.replyTo || environment.email?.contact || fromAddress,
      status: MailDeliveryState.Pending,
      delivery: {
        state: MailDeliveryState.Pending,
        attempts: 0,
        error: null,
      },
      message: {
        subject,
        text: bodyMarkdown,
        html,
      },
      metadata: {
        adminTest: true,
        requestedBy: request.auth?.token.email,
        sentAt: new Date().toISOString(),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(
      `[MailProcessor] Admin test email enqueued to mail/${mailDocRef.id}. Awaiting queue processing...`,
    );

    // Wait for the background processMailQueue trigger to process the queue document
    const timeoutMs = 8000;
    const intervalMs = 250;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const snap = await mailDocRef.get();
      const mailData = snap.data() as MailQueueDoc | undefined;
      const state = mailData?.status || mailData?.delivery?.state;

      if (state === 'SUCCESS') {
        return {
          success: true,
          messageId: (mailData?.delivery?.info?.messageId as string) || undefined,
          simulated: (mailData?.delivery?.info?.simulated as boolean) || false,
          docId: mailDocRef.id,
        };
      }

      if (state === 'ERROR') {
        return {
          success: false,
          error: mailData?.delivery?.error || 'Failed to deliver email through mail queue',
          docId: mailDocRef.id,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    // If timeout reached before trigger finished (e.g. cold start or in tests), return enqueued status
    return {
      success: true,
      docId: mailDocRef.id,
    };
  },
);

export interface RetryMailItemRequest {
  mailId: string;
}

export interface RetryMailItemResponse {
  success: boolean;
  docId: string;
  error?: string;
}

/**
 * Admin-only callable Cloud Function to safely retry a failed email.
 * Validates admin credentials via assertAdmin, confirms document existence,
 * and resets status and delivery.state to 'PENDING'.
 */
export const retryMailItem = onCall(
  {
    cors: allowedOrigins,
  },
  async (request): Promise<RetryMailItemResponse> => {
    logger.info('[MailProcessor] retryMailItem called');
    await assertAdmin(request);

    const data = request.data as RetryMailItemRequest | undefined;
    if (!data || !data.mailId) {
      throw new HttpsError('invalid-argument', 'Document ID (mailId) is required.');
    }

    const mailId = data.mailId.trim();
    const db = admin.firestore();
    const docRef = db.collection(FirestoreCollection.Mail).doc(mailId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new HttpsError('not-found', `Mail document "${mailId}" not found.`);
    }

    const mailData = snap.data() as MailQueueDoc | undefined;
    const currentState = mailData?.status || mailData?.delivery?.state;
    if (currentState === MailDeliveryState.Processing) {
      throw new HttpsError(
        'failed-precondition',
        `Mail document "${mailId}" is currently being processed.`,
      );
    }

    await docRef.update({
      status: MailDeliveryState.Pending,
      'delivery.state': MailDeliveryState.Pending,
      'delivery.error': null,
      'delivery.retryRequestedAt': admin.firestore.FieldValue.serverTimestamp(),
      'delivery.retryRequestedBy': request.auth?.token.email || 'admin',
    });

    logger.info(`[MailProcessor] Mail document ${mailId} reset to PENDING for retry.`);
    return {
      success: true,
      docId: mailId,
    };
  },
);

/**
 * Admin-only callable Cloud Function to delete one or more documents from the `/mail` queue.
 * Safely guards against deleting items that are currently in 'PROCESSING' state.
 */
export const deleteMailItems = onCall(
  {
    cors: allowedOrigins,
  },
  async (request): Promise<DeleteMailItemsResponse> => {
    logger.info('[MailProcessor] deleteMailItems called');
    await assertAdmin(request);

    const data = request.data as DeleteMailItemsRequest | undefined;
    if (!data || !Array.isArray(data.mailIds) || data.mailIds.length === 0) {
      throw new HttpsError('invalid-argument', 'An array of "mailIds" is required.');
    }

    if (data.mailIds.length > 500) {
      throw new HttpsError('invalid-argument', 'Cannot delete more than 500 mail items at once.');
    }

    const uniqueIds = Array.from(new Set(data.mailIds.map((id) => String(id).trim()).filter(Boolean)));
    if (uniqueIds.length === 0) {
      throw new HttpsError('invalid-argument', 'No valid mail IDs provided.');
    }

    const db = admin.firestore();
    const mailCollection = db.collection(FirestoreCollection.Mail);

    const docRefs = uniqueIds.map((id) => mailCollection.doc(id));
    const snaps = await db.getAll(...docRefs);

    const batch = db.batch();
    let deletedCount = 0;
    const skippedProcessingIds: string[] = [];

    for (const snap of snaps) {
      if (!snap.exists) continue;

      const mailData = snap.data() as MailQueueDoc | undefined;
      const state = mailData?.status || mailData?.delivery?.state;
      if (state === MailDeliveryState.Processing) {
        skippedProcessingIds.push(snap.id);
        continue;
      }

      batch.delete(snap.ref);
      deletedCount++;
    }

    if (deletedCount > 0) {
      await batch.commit();
    }

    logger.info(
      `[MailProcessor] deleteMailItems deleted ${deletedCount} item(s), skipped ${skippedProcessingIds.length} item(s) in PROCESSING.`,
    );

    return {
      success: true,
      deletedCount,
      skippedCount: skippedProcessingIds.length,
      skippedProcessingIds,
    };
  },
);

/**
 * Admin-only callable Cloud Function to update a mail document in the `/mail` queue.
 * Allows updating recipient ('to'), subject, text/body (re-rendering markdown to html),
 * templateData parameters, and status ('PENDING', 'PAUSED', 'ERROR').
 * Guards against modifying items currently in 'PROCESSING' state.
 */
export const updateMailItem = onCall(
  {
    cors: allowedOrigins,
  },
  async (request): Promise<UpdateMailItemResponse> => {
    logger.info('[MailProcessor] updateMailItem called');
    await assertAdmin(request);

    const data = request.data as UpdateMailItemRequest | undefined;
    if (!data || !data.mailId) {
      throw new HttpsError('invalid-argument', 'Document ID (mailId) is required.');
    }

    const mailId = data.mailId.trim();
    const db = admin.firestore();
    const docRef = db.collection(FirestoreCollection.Mail).doc(mailId);
    const snap = await docRef.get();

    if (!snap.exists) {
      throw new HttpsError('not-found', `Mail document "${mailId}" not found.`);
    }

    const mailData = snap.data() as MailQueueDoc | undefined;
    const currentState = mailData?.status || mailData?.delivery?.state;
    if (currentState === MailDeliveryState.Processing) {
      throw new HttpsError(
        'failed-precondition',
        `Mail document "${mailId}" is currently being processed and cannot be edited.`,
      );
    }

    const updates: Record<string, unknown> = {
      'metadata.lastEditedAt': new Date().toISOString(),
      'metadata.lastEditedBy': request.auth?.token.email || 'admin',
    };

    if (data.to !== undefined) {
      if (Array.isArray(data.to)) {
        const recipients = data.to.map((r) => String(r).trim()).filter(Boolean);
        if (recipients.length === 0) {
          throw new HttpsError('invalid-argument', 'Recipient array cannot be empty.');
        }
        updates['to'] = recipients;
      } else if (typeof data.to === 'string') {
        const trimmed = data.to.trim();
        if (!trimmed) {
          throw new HttpsError('invalid-argument', 'Recipient cannot be empty.');
        }
        if (trimmed.includes(',')) {
          updates['to'] = trimmed.split(',').map((r) => r.trim()).filter(Boolean);
        } else {
          updates['to'] = trimmed;
        }
      }
    }

    if (data.subject !== undefined) {
      const trimmedSubject = String(data.subject).trim();
      updates['subject'] = trimmedSubject;
      updates['message.subject'] = trimmedSubject;
    }

    if (data.text !== undefined) {
      const trimmedText = String(data.text);
      updates['text'] = trimmedText;
      updates['message.text'] = trimmedText;
      const htmlContent = data.html !== undefined ? data.html : markdownToHtml(trimmedText);
      updates['html'] = htmlContent;
      updates['message.html'] = htmlContent;
    } else if (data.html !== undefined) {
      updates['html'] = data.html;
      updates['message.html'] = data.html;
    }

    if (data.templateData !== undefined && typeof data.templateData === 'object') {
      updates['templateData'] = data.templateData;
    }

    if (data.status) {
      if (![MailDeliveryState.Pending, MailDeliveryState.Paused, MailDeliveryState.Error].includes(data.status)) {
        throw new HttpsError('invalid-argument', `Invalid status "${data.status}".`);
      }
      updates['status'] = data.status;
      updates['delivery.state'] = data.status;

      if (data.status === MailDeliveryState.Pending) {
        updates['delivery.error'] = null;
        updates['delivery.retryRequestedAt'] = admin.firestore.FieldValue.serverTimestamp();
        updates['delivery.retryRequestedBy'] = request.auth?.token.email || 'admin';
      }
    }

    await docRef.update(updates);

    logger.info(`[MailProcessor] Mail document ${mailId} successfully updated.`);
    return {
      success: true,
      docId: mailId,
    };
  },
);

export interface SetMailSendingStateRequest {
  status: MailSendingStatus;
  templateKey?: TransactionalEmailKey | 'all';
}

export interface SetMailSendingStateResponse {
  success: boolean;
  status: MailSendingStatus;
  resumedCount: number;
  templateKey?: string;
}

/**
 * Admin-only callable Cloud Function to change outbound mail sending state ('active' | 'paused' | 'off').
 * Can target a specific templateKey or 'all' (system-wide).
 * When transitioning to 'active', documents in /mail with status: 'PAUSED' (matching templateKey or all)
 * are transitioned to 'PENDING', which fires processMailQueue to dynamically render templates and dispatch emails.
 */
export const setMailSendingState = onCall(
  {
    cors: allowedOrigins,
  },
  async (request): Promise<SetMailSendingStateResponse> => {
    logger.info('[MailProcessor] setMailSendingState called');
    await assertAdmin(request);

    const data = request.data as SetMailSendingStateRequest | undefined;
    const validStatuses = Object.values(MailSendingStatus);
    if (!data || !validStatuses.includes(data.status)) {
      throw new HttpsError(
        'invalid-argument',
        `Invalid status parameter. Must be one of: ${validStatuses.join(', ')}`,
      );
    }

    const status = data.status;
    const templateKey = data.templateKey;
    const isSingleKey =
      templateKey &&
      templateKey !== 'all' &&
      Object.values(TransactionalEmailKey).includes(templateKey as TransactionalEmailKey);

    const db = admin.firestore();
    const settingsRef = db.doc('system/mail-settings');
    const now = new Date().toISOString();
    const adminEmail = request.auth?.token.email || 'admin';

    let resumedCount = 0;

    if (isSingleKey) {
      const key = templateKey as TransactionalEmailKey;
      const snap = await settingsRef.get();
      const current = snap.exists ? (snap.data() as MailSettings) : initMailSettings();
      const notificationStatus = { ...(current.notificationStatus || {}) };
      notificationStatus[key] = status;

      // Check if all keys share the same status to keep top-level status aligned
      const allSame = ALL_TRANSACTIONAL_EMAIL_KEYS.every(
        (k) => notificationStatus[k] === status,
      );

      const updates: Partial<MailSettings> = {
        notificationStatus,
        updatedAt: now,
        updatedBy: adminEmail,
        ...(allSame ? { status, sendingPaused: status === MailSendingStatus.Paused } : {}),
      };

      await settingsRef.set(updates, { merge: true });

      // If transitioning single key to active, resume paused emails matching this templateKey
      if (status === MailSendingStatus.Active) {
        const pausedDocsSnap = await db
          .collection(FirestoreCollection.Mail)
          .where('status', '==', MailDeliveryState.Paused)
          .where('templateKey', '==', key)
          .get();

        if (!pausedDocsSnap.empty) {
          const batch = db.batch();
          for (const doc of pausedDocsSnap.docs) {
            batch.update(doc.ref, {
              status: MailDeliveryState.Pending,
              'delivery.state': MailDeliveryState.Pending,
              'delivery.resumedAt': admin.firestore.FieldValue.serverTimestamp(),
              'delivery.resumedBy': adminEmail,
            });
            resumedCount++;
          }
          await batch.commit();
        }
      }

      logger.info(
        `[MailProcessor] Notification status for ${key} set to ${status} by ${adminEmail}. Resumed ${resumedCount} paused emails.`,
      );

      return {
        success: true,
        status,
        resumedCount,
        templateKey: key,
      };
    } else {
      // Top-level action: Pause All, Turn Off All, or Make All Active
      const notificationStatus: Partial<Record<TransactionalEmailKey, MailSendingStatus>> = {};
      for (const key of ALL_TRANSACTIONAL_EMAIL_KEYS) {
        notificationStatus[key] = status;
      }

      const updates: Partial<MailSettings> = {
        status,
        notificationStatus,
        sendingPaused: status === MailSendingStatus.Paused,
        updatedAt: now,
        updatedBy: adminEmail,
        ...(status === MailSendingStatus.Paused ? { pausedAt: now, pausedBy: adminEmail } : {}),
        ...(status === MailSendingStatus.Active ? { resumedAt: now, resumedBy: adminEmail } : {}),
      };

      await settingsRef.set(updates, { merge: true });

      if (status === MailSendingStatus.Active) {
        const pausedDocsSnap = await db
          .collection(FirestoreCollection.Mail)
          .where('status', '==', MailDeliveryState.Paused)
          .get();

        if (!pausedDocsSnap.empty) {
          const batch = db.batch();
          for (const doc of pausedDocsSnap.docs) {
            batch.update(doc.ref, {
              status: MailDeliveryState.Pending,
              'delivery.state': MailDeliveryState.Pending,
              'delivery.resumedAt': admin.firestore.FieldValue.serverTimestamp(),
              'delivery.resumedBy': adminEmail,
            });
            resumedCount++;
          }
          await batch.commit();
        }
      }

      logger.info(
        `[MailProcessor] System-wide mail sending status set to ${status} by ${adminEmail}. Resumed ${resumedCount} paused emails.`,
      );

      return {
        success: true,
        status,
        resumedCount,
        templateKey: 'all',
      };
    }
  },
);

export interface SetMailSendingPausedRequest {
  paused: boolean;
}

export interface SetMailSendingPausedResponse {
  success: boolean;
  paused: boolean;
  resumedCount: number;
}

/**
 * Admin-only callable Cloud Function to pause or resume outbound mail sending.
 * Provided for backwards compatibility; delegates state transition to 'paused' vs 'active'.
 */
export const setMailSendingPaused = onCall(
  {
    cors: allowedOrigins,
  },
  async (request): Promise<SetMailSendingPausedResponse> => {
    logger.info('[MailProcessor] setMailSendingPaused called');
    await assertAdmin(request);

    const data = request.data as SetMailSendingPausedRequest | undefined;
    if (!data || typeof data.paused !== 'boolean') {
      throw new HttpsError('invalid-argument', 'Boolean parameter "paused" is required.');
    }

    const targetStatus = data.paused ? MailSendingStatus.Paused : MailSendingStatus.Active;
    const db = admin.firestore();
    const settingsRef = db.doc('system/mail-settings');
    const now = new Date().toISOString();
    const adminEmail = request.auth?.token.email || 'admin';

    const updates: Partial<MailSettings> = {
      status: targetStatus,
      sendingPaused: data.paused,
      updatedAt: now,
      updatedBy: adminEmail,
      ...(data.paused ? { pausedAt: now, pausedBy: adminEmail } : { resumedAt: now, resumedBy: adminEmail }),
    };

    await settingsRef.set(updates, { merge: true });

    let resumedCount = 0;
    if (!data.paused) {
      const pausedDocsSnap = await db
        .collection(FirestoreCollection.Mail)
        .where('status', '==', MailDeliveryState.Paused)
        .get();

      if (!pausedDocsSnap.empty) {
        const batch = db.batch();
        for (const doc of pausedDocsSnap.docs) {
          batch.update(doc.ref, {
            status: MailDeliveryState.Pending,
            'delivery.state': MailDeliveryState.Pending,
            'delivery.resumedAt': admin.firestore.FieldValue.serverTimestamp(),
            'delivery.resumedBy': adminEmail,
          });
          resumedCount++;
        }
        await batch.commit();
      }
    }

    logger.info(
      `[MailProcessor] Mail sending set to ${targetStatus} by ${adminEmail}. Resumed ${resumedCount} paused emails.`,
    );

    return {
      success: true,
      paused: data.paused,
      resumedCount,
    };
  },
);


