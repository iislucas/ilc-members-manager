import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import nodemailer, { type Transporter, type SentMessageInfo } from 'nodemailer';
import { environment } from './environment/environment';
import { assertAdmin, allowedOrigins } from './common';
import { markdownToHtml, formatTemplate } from './email-markdown';
import { FirestoreCollection } from './data-model/collections';
import { MailQueueDoc, MailDeliveryState, MailSettings, MailSendingStatus } from './data-model/mail';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';

export { MailQueueDoc, MailDeliveryState, MailSettings, MailSendingStatus } from './data-model/mail';
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

  return await transporter.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    replyTo,
    subject,
    text,
    html,
  });
}

/**
 * Cloud Function that processes task documents in the `/mail` collection.
 * Replaces the heavy Firebase "Trigger Email" extension with a simple, secure,
 * native Cloud Function that authenticates with the SMTP_PASSWORD secret.
 *
 * ANTI-CIRCULAR SENDING PROTECTION:
 * - Triggers on document write (allowing retries when an admin sets status: 'PENDING').
 * - Fast-check: if document status is NOT 'PENDING', returns immediately.
 * - Atomically locks the document inside a Firestore transaction, transitioning it
 *   from 'PENDING' -> 'PROCESSING'.
 * - Any subsequent writes (such as marking 'SUCCESS' or 'ERROR') will see status !== 'PENDING'
 *   and will NEVER re-trigger email sending.
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

    // 1. Fast guard: ONLY send emails that are explicitly 'PENDING'.
    // If status is 'PROCESSING', 'SUCCESS', 'ERROR', or 'PAUSED', exit immediately to avoid circular sends.
    const effectiveState = data.status || data.delivery?.state || 'PENDING';
    if (effectiveState !== 'PENDING') {
      return;
    }

    const db = admin.firestore();

    // Check if mail sending is globally active, paused, or off in /system/mail-settings.
    // Admin test emails always bypass this check to allow admins to safely test configurations.
    const mailSettingsSnap = await db.doc('system/mail-settings').get();
    const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
    const status: MailSendingStatus =
      mailSettings?.status ?? (mailSettings?.sendingPaused ? MailSendingStatus.Paused : MailSendingStatus.Off);

    if (!data.metadata?.adminTest) {
      if (status === MailSendingStatus.Off) {
        logger.info(`[MailProcessor] Mail sending is OFF. Skipping document ${mailId}.`);
        return;
      }
      if (status === MailSendingStatus.Paused) {
        logger.info(`[MailProcessor] Mail sending is PAUSED. Setting document ${mailId} to PAUSED.`);
        await snap.ref.update({
          status: 'PAUSED',
          'delivery.state': 'PAUSED',
        });
        return;
      }
    }

    const recipients = Array.isArray(data.to) ? data.to.join(', ') : data.to;
    if (!recipients) {
      logger.warn(`[MailProcessor] Mail document ${mailId} has no recipient. Skipping.`);
      await snap.ref.update({
        status: 'ERROR',
        'delivery.state': 'ERROR',
        'delivery.error': 'No recipient specified in mail document',
        'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    const fromAddress = data.from || environment.email?.from;
    if (!fromAddress) {
      logger.error(
        `[MailProcessor] Mail document ${mailId} has no "from" address and environment.email.from is not set.`,
      );
      await snap.ref.update({
        status: 'ERROR',
        'delivery.state': 'ERROR',
        'delivery.error':
          'No sender "from" address specified in mail document or environment.email.from',
        'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
      });
      return;
    }

    // 2. Atomic lock: ensure we are the sole processor and prevent duplicate/circular runs
    const docRef = snap.ref;
    let locked = false;

    try {
      locked = await db.runTransaction(async (tx) => {
        const curDoc = await tx.get(docRef);
        if (!curDoc.exists) return false;
        const curData = curDoc.data() as MailQueueDoc;
        const curState = curData.status || curData.delivery?.state || 'PENDING';
        if (curState !== 'PENDING') {
          return false;
        }
        tx.update(docRef, {
          status: 'PROCESSING',
          'delivery.state': 'PROCESSING',
          'delivery.startTime': admin.firestore.FieldValue.serverTimestamp(),
          'delivery.attempts': admin.firestore.FieldValue.increment(1),
        });
        return true;
      });
    } catch (txErr) {
      logger.warn(`[MailProcessor] Lock transaction failed for mailId ${mailId}:`, txErr);
      return;
    }

    if (!locked) {
      logger.info(`[MailProcessor] Document ${mailId} is already locked or completed. Skipping.`);
      return;
    }

    // 3. Dynamic template interpretation: If document specifies a templateKey and templateData,
    // render the latest templates from /system/email-templates so any edits made while queued take effect.
    if (data.templateKey && data.templateData) {
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

          await snap.ref.update({
            message: data.message,
          });
        }
      } catch (renderErr) {
        logger.warn(`[MailProcessor] Failed to dynamically render template for ${mailId}:`, renderErr);
      }
    }

    let password = '';
    try {
      password = smtpPassword.value() || '';
    } catch {
      password = '';
    }

    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

    // In local emulator mode or when no SMTP_PASSWORD secret is configured,
    // simulate successful delivery without throwing network errors.
    if (isEmulator || !password) {
      logger.info(
        `[MailProcessor] Simulating delivery for mailId ${mailId} to [${recipients}] (${
          !password ? 'No SMTP_PASSWORD secret configured' : 'Running in local emulator'
        }).`,
      );
      await snap.ref.update({
        status: 'SUCCESS',
        'delivery.state': 'SUCCESS',
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

      await snap.ref.update({
        status: 'SUCCESS',
        'delivery.state': 'SUCCESS',
        'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
        'delivery.info': {
          messageId: info.messageId,
          response: info.response,
        },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[MailProcessor] Failed to deliver email ${mailId} to [${recipients}]:`, err);
      await snap.ref.update({
        status: 'ERROR',
        'delivery.state': 'ERROR',
        'delivery.endTime': admin.firestore.FieldValue.serverTimestamp(),
        'delivery.error': errorMsg,
      });
    }
  },
);

export interface SendAdminTestEmailRequest {
  to: string;
  subject: string;
  bodyMarkdown: string;
  fromName?: string;
  replyTo?: string;
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
    const subject = data.subject.trim();
    const bodyMarkdown = data.bodyMarkdown.trim();
    const html = markdownToHtml(bodyMarkdown);
    const db = admin.firestore();

    // Enqueue document into `/mail` using the exact same code pathway as transactional emails
    const mailDocRef = await db.collection(FirestoreCollection.Mail).add({
      to: [recipient],
      from: fromAddress,
      replyTo: data.replyTo || environment.email?.contact || fromAddress,
      status: 'PENDING',
      delivery: {
        state: 'PENDING',
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
    if (currentState === 'PROCESSING') {
      throw new HttpsError(
        'failed-precondition',
        `Mail document "${mailId}" is currently being processed.`,
      );
    }

    await docRef.update({
      status: 'PENDING',
      'delivery.state': 'PENDING',
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

export interface SetMailSendingStateRequest {
  status: MailSendingStatus;
}

export interface SetMailSendingStateResponse {
  success: boolean;
  status: MailSendingStatus;
  resumedCount: number;
}

/**
 * Admin-only callable Cloud Function to change outbound mail sending state ('active' | 'paused' | 'off').
 * When transitioning to 'active', all documents in /mail with status: 'PAUSED' are transitioned to 'PENDING',
 * which fires processMailQueue to dynamically render templates and dispatch emails.
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
    const db = admin.firestore();
    const settingsRef = db.doc('system/mail-settings');
    const now = new Date().toISOString();
    const adminEmail = request.auth?.token.email || 'admin';

    const updates: Partial<MailSettings> = {
      status,
      sendingPaused: status === MailSendingStatus.Paused,
      updatedAt: now,
      updatedBy: adminEmail,
      ...(status === MailSendingStatus.Paused ? { pausedAt: now, pausedBy: adminEmail } : {}),
      ...(status === MailSendingStatus.Active ? { resumedAt: now, resumedBy: adminEmail } : {}),
    };

    await settingsRef.set(updates, { merge: true });

    let resumedCount = 0;
    if (status === MailSendingStatus.Active) {
      const pausedDocsSnap = await db
        .collection(FirestoreCollection.Mail)
        .where('status', '==', 'PAUSED')
        .get();

      if (!pausedDocsSnap.empty) {
        const batch = db.batch();
        for (const doc of pausedDocsSnap.docs) {
          batch.update(doc.ref, {
            status: 'PENDING',
            'delivery.state': 'PENDING',
            'delivery.resumedAt': admin.firestore.FieldValue.serverTimestamp(),
            'delivery.resumedBy': adminEmail,
          });
          resumedCount++;
        }
        await batch.commit();
      }
    }

    logger.info(
      `[MailProcessor] Mail sending status set to ${status} by ${adminEmail}. Resumed ${resumedCount} paused emails.`,
    );

    return {
      success: true,
      status,
      resumedCount,
    };
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
        .where('status', '==', 'PAUSED')
        .get();

      if (!pausedDocsSnap.empty) {
        const batch = db.batch();
        for (const doc of pausedDocsSnap.docs) {
          batch.update(doc.ref, {
            status: 'PENDING',
            'delivery.state': 'PENDING',
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


