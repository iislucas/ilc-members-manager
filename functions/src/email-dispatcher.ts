import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { environment } from './environment/environment';
import { FirestoreCollection } from './data-model/collections';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';
import { formatTemplate, markdownToHtml } from './email-markdown';

import { MailSettings, MailQueueDoc, MailSendingStatus } from './data-model/mail';

export type TransactionalEmailKey =
  | 'membershipActivated'
  | 'instructorLicenseActivated'
  | 'orderConfirmation'
  | 'eventRegistrationConfirmation'
  | 'vodPurchaseConfirmation'
  | 'gradingPaymentConfirmation'
  | 'subscriptionRenewal'
  | 'eventDigestOverall';

export interface SendEmailOptions {
  to: string | string[];
  templateKey: TransactionalEmailKey;
  replacements: Record<string, string>;
  replyTo?: string;
}

/**
 * Loads the active email templates (custom overrides from Firestore or defaults),
 * substitutes token replacements, converts markdown to HTML, and enqueues the email
 * to the `/mail` collection.
 *
 * If mail sending is paused in /system/mail-settings, enqueues a placeholder document
 * with status: 'PAUSED' storing the templateKey and replacements (templateData).
 * Template rendering will be deferred until mail sending is re-enabled.
 */
export async function sendTransactionalEmail(
  db: admin.firestore.Firestore,
  options: SendEmailOptions,
): Promise<string | null> {
  const fromAddress = environment.email?.from;
  if (!fromAddress) {
    logger.info(`[EmailDispatcher] Outbound email disabled (environment.email.from is empty). Skipping.`);
    return null;
  }

  const toList = Array.isArray(options.to) ? options.to : [options.to];
  const validRecipients = toList
    .map((e) => (e || '').trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes('@'));

  if (validRecipients.length === 0) {
    logger.warn(`[EmailDispatcher] No valid recipient email addresses for template ${options.templateKey}. Skipping.`);
    return null;
  }

  try {
    // Resolve global mail status (defaults strictly to OFF if unconfigured)
    const mailSettingsSnap = await db.doc('system/mail-settings').get();
    const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
    const status: MailSendingStatus =
      mailSettings?.status ?? (mailSettings?.sendingPaused ? MailSendingStatus.Paused : MailSendingStatus.Off);

    // 1. If mail sending is OFF: do NOT write any document to /mail
    if (status === MailSendingStatus.Off) {
      logger.info(
        `[EmailDispatcher] Mail sending is OFF. Skipping notification for template ${options.templateKey}.`,
      );
      return null;
    }

    // 2. If mail sending is PAUSED: enqueue placeholder document with raw template key & data (no rendered HTML)
    if (status === MailSendingStatus.Paused) {
      // Defer template interpretation: write placeholder document with raw template key & data
      const mailRef = await db.collection(FirestoreCollection.Mail).add({
        to: validRecipients,
        from: fromAddress,
        replyTo: options.replyTo || environment.email?.contact || fromAddress,
        status: 'PAUSED',
        delivery: {
          state: 'PAUSED',
          attempts: 0,
          error: null,
        },
        templateKey: options.templateKey,
        templateData: options.replacements,
        message: {
          subject: `[Queued / Paused] Template: ${options.templateKey}`,
          text: '',
          html: '',
        },
        metadata: {
          templateKey: options.templateKey,
          paused: true,
          queuedAt: new Date().toISOString(),
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(
        `[EmailDispatcher] Mail sending is paused. Enqueued placeholder for ${options.templateKey} email to ${validRecipients.join(', ')} (mailId: ${mailRef.id}).`,
      );
      return mailRef.id;
    }

    // 1. Fetch custom templates or use system defaults
    const snap = await db.doc('system/email-templates').get();
    const customTemplates = snap.exists ? (snap.data() as Partial<EmailTemplates>) : {};
    const defaults = initEmailTemplates();

    const subjectKey = `${options.templateKey}Subject` as keyof EmailTemplates;
    const bodyKey = `${options.templateKey}Body` as keyof EmailTemplates;

    const subjectTemplate = customTemplates[subjectKey] || defaults[subjectKey] || '';
    const bodyTemplate = customTemplates[bodyKey] || defaults[bodyKey] || '';

    // 2. Perform token substitution
    const formattedSubject = formatTemplate(subjectTemplate, options.replacements);
    const formattedMarkdown = formatTemplate(bodyTemplate, options.replacements);

    // 3. Render Markdown to email-safe HTML
    const htmlBody = markdownToHtml(formattedMarkdown);

    // 4. Enqueue into /mail with status: 'PENDING'
    const mailRef = await db.collection(FirestoreCollection.Mail).add({
      to: validRecipients,
      from: fromAddress,
      replyTo: options.replyTo || environment.email?.contact || fromAddress,
      status: 'PENDING',
      delivery: {
        state: 'PENDING',
        attempts: 0,
        error: null,
      },
      templateKey: options.templateKey,
      templateData: options.replacements,
      message: {
        subject: formattedSubject,
        text: formattedMarkdown,
        html: htmlBody,
      },
      metadata: {
        templateKey: options.templateKey,
        sentAt: new Date().toISOString(),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(
      `[EmailDispatcher] Enqueued ${options.templateKey} email for ${validRecipients.join(', ')} (mailId: ${mailRef.id}).`,
    );
    return mailRef.id;
  } catch (error) {
    logger.error(`[EmailDispatcher] Failed to enqueue ${options.templateKey} email:`, error);
    return null;
  }
}
