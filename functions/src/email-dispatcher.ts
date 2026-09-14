import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { environment } from './environment/environment';
import { FirestoreCollection } from './data-model/collections';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';
import { formatTemplate, markdownToHtml } from './email-markdown';
import {
  MailSettings,
  MailQueueDoc,
  MailSendingStatus,
  MailDeliveryState,
  TransactionalEmailKey,
} from './data-model/mail';
import { Member } from './data-model/members';
import { getUnsubscribeSecret, generateUnsubscribeToken } from './unsubscribe-token';

export { TransactionalEmailKey };

export interface SendEmailOptions {
  to: string | string[];
  templateKey: TransactionalEmailKey;
  replacements: Record<string, string>;
  replyTo?: string;
}

/**
 * Normalizes and filters a recipient list to unique, valid email addresses.
 */
export function extractValidRecipients(to: string | string[]): string[] {
  const toList = Array.isArray(to) ? to : [to];
  return toList
    .map((e) => (e || '').trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes('@'));
}

/**
 * Checks if the recipient member has opted out of this specific transactional email kind,
 * or muted email notifications globally.
 */
export async function isMemberEmailOptedOut(
  db: admin.firestore.Firestore,
  email: string,
  templateKey: TransactionalEmailKey,
): Promise<boolean> {
  try {
    const snap = await db
      .collection(FirestoreCollection.Members)
      .where('emails', 'array-contains', email.toLowerCase())
      .limit(1)
      .get();

    if (snap.empty) {
      return false;
    }

    const member = snap.docs[0].data() as Member;
    const settings = member.notificationSettings;
    if (!settings) {
      return false;
    }

    if (settings.globalEmailEnabled === false) {
      return true;
    }

    if (settings.emailEnabled && settings.emailEnabled[templateKey] === false) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export interface BuildMailDocParams {
  validRecipients: string[];
  options: SendEmailOptions;
  fromAddress: string;
  unsubscribeSecret: string;
  appBase: string;
  isPaused: boolean;
  db: admin.firestore.Firestore;
}

/**
 * Builds the MailQueueDoc payload with tokens, RFC 8058 headers, and markdown/HTML formatting.
 */
export async function buildTransactionalMailDoc(params: BuildMailDocParams): Promise<Omit<MailQueueDoc, 'docId'>> {
  const { validRecipients, options, fromAddress, unsubscribeSecret, appBase, isPaused, db } = params;
  const primaryRecipient = validRecipients[0];
  const token = generateUnsubscribeToken(primaryRecipient, unsubscribeSecret);
  const unsubscribeUrl = `${appBase}/unsubscribe?email=${encodeURIComponent(primaryRecipient)}&token=${encodeURIComponent(token)}&kind=${encodeURIComponent(options.templateKey)}`;
  const preferencesUrl = `${appBase}/settings/notifications`;

  const fullReplacements: Record<string, string> = {
    appBase,
    unsubscribeUrl,
    preferencesUrl,
    ...options.replacements,
  };

  if (isPaused) {
    return {
      to: validRecipients,
      from: fromAddress,
      replyTo: options.replyTo || environment.email?.contact || fromAddress,
      status: MailDeliveryState.Paused,
      delivery: {
        state: MailDeliveryState.Paused,
        attempts: 0,
        error: null,
      },
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      templateKey: options.templateKey,
      templateData: fullReplacements,
      message: {
        subject: `[Queued / Paused] Template: ${options.templateKey}`,
        text: '',
        html: '',
      },
      metadata: {
        templateKey: options.templateKey,
        paused: true,
        unsubscribeUrl,
        queuedAt: new Date().toISOString(),
      },
    };
  }

  const snap = await db.doc('system/email-templates').get();
  const customTemplates = snap.exists ? (snap.data() as Partial<EmailTemplates>) : {};
  const defaults = initEmailTemplates();

  const subjectKey = `${options.templateKey}Subject` as keyof EmailTemplates;
  const bodyKey = `${options.templateKey}Body` as keyof EmailTemplates;

  const subjectTemplate = customTemplates[subjectKey] || defaults[subjectKey] || '';
  const bodyTemplate = customTemplates[bodyKey] || defaults[bodyKey] || '';

  const formattedSubject = formatTemplate(subjectTemplate, fullReplacements);
  const formattedMarkdown = formatTemplate(bodyTemplate, fullReplacements);
  const htmlBody = markdownToHtml(formattedMarkdown);

  return {
    to: validRecipients,
    from: fromAddress,
    replyTo: options.replyTo || environment.email?.contact || fromAddress,
    status: MailDeliveryState.Pending,
    delivery: {
      state: MailDeliveryState.Pending,
      attempts: 0,
      error: null,
    },
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    templateKey: options.templateKey,
    templateData: fullReplacements,
    message: {
      subject: formattedSubject,
      text: formattedMarkdown,
      html: htmlBody,
    },
    metadata: {
      templateKey: options.templateKey,
      unsubscribeUrl,
      sentAt: new Date().toISOString(),
    },
  };
}

/**
 * Loads the active email templates, checks user opt-out preferences, attaches one-click
 * unsubscribe headers, substitutes token replacements, converts markdown to HTML,
 * and enqueues the email to the `/mail` collection.
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

  const validRecipients = extractValidRecipients(options.to);
  if (validRecipients.length === 0) {
    logger.warn(`[EmailDispatcher] No valid recipient email addresses for template ${options.templateKey}. Skipping.`);
    return null;
  }

  try {
    // Check if the member has opted out of this transactional category
    const isOptedOut = await isMemberEmailOptedOut(db, validRecipients[0], options.templateKey);
    if (isOptedOut) {
      logger.info(
        `[EmailDispatcher] Recipient ${validRecipients[0]} opted out of ${options.templateKey}. Skipping.`,
      );
      return null;
    }

    // Resolve global mail status (defaults strictly to OFF if unconfigured)
    const mailSettingsSnap = await db.doc('system/mail-settings').get();
    const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
    const status: MailSendingStatus =
      mailSettings?.status ?? (mailSettings?.sendingPaused ? MailSendingStatus.Paused : MailSendingStatus.Off);

    if (status === MailSendingStatus.Off) {
      logger.info(
        `[EmailDispatcher] Mail sending is OFF. Skipping notification for template ${options.templateKey}.`,
      );
      return null;
    }

    const isPaused = status === MailSendingStatus.Paused;
    const unsubscribeSecret = await getUnsubscribeSecret(db);
    const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';

    const mailDoc = await buildTransactionalMailDoc({
      validRecipients,
      options,
      fromAddress,
      unsubscribeSecret,
      appBase,
      isPaused,
      db,
    });

    const mailRef = await db.collection(FirestoreCollection.Mail).add({
      ...mailDoc,
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
