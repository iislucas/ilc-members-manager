import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { environment } from './environment/environment';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';
import { formatTemplate, markdownToHtml } from './email-markdown';
import { Member } from './data-model/members';
import { IlcEvent, resolveEventDates, formatEventDigestItemContext, firestoreDocToIlcEvent } from './data-model/events';
import { FirestoreCollection } from './data-model/collections';
import { MailSettings, MailSendingStatus, MailDeliveryState } from './data-model/mail';

export { resolveEventDates, formatEventDigestItemContext };

/**
 * Weekly upcoming events digest: runs every Monday at 08:00 UTC.
 */
export const sendWeeklyEventDigest = onSchedule(
  { schedule: '0 8 * * 1', timeZone: 'UTC' },
  async () => {
    const db = admin.firestore();
    await processEventDigest(db, 'weekly', 'the next 3 months');
  },
);

/**
 * Monthly upcoming events digest: runs on the 1st of every month at 08:00 UTC.
 */
export const sendMonthlyEventDigest = onSchedule(
  { schedule: '0 8 1 * *', timeZone: 'UTC' },
  async () => {
    const db = admin.firestore();
    await processEventDigest(db, 'monthly', 'the next 3 months');
  },
);

/**
 * Core event digest processor. Queries upcoming listed events occurring in the next 3 months,
 * compiles them using the Per-Event template into {eventsList}, wraps inside the Overall Email
 * template, and enqueues tasks to the `/mail` collection.
 */
export async function processEventDigest(
  db: admin.firestore.Firestore,
  frequency: 'weekly' | 'monthly',
  periodLabel = 'the next 3 months',
): Promise<number> {
  const fromAddress = environment.email?.from;
  if (!fromAddress) {
    logger.info(`[EventDigest] Outbound email disabled (environment.email.from is empty). Skipping ${frequency} digest.`);
    return 0;
  }

  // Resolve global mail status (defaults strictly to OFF if unconfigured)
  const mailSettingsSnap = await db.doc('system/mail-settings').get();
  const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
  const status: MailSendingStatus =
    mailSettings?.status ?? (mailSettings?.sendingPaused ? MailSendingStatus.Paused : MailSendingStatus.Off);

  if (status === MailSendingStatus.Off) {
    logger.info(`[EventDigest] Mail sending is OFF. Skipping ${frequency} digest dispatch.`);
    return 0;
  }

  const isPaused = status === MailSendingStatus.Paused;

  // 1. Calculate the 3-month window from today
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const future = new Date(now);
  future.setMonth(future.getMonth() + 3);
  const maxDate = future.toISOString().split('T')[0];

  // Query listed events from /events
  const eventsSnap = await db
    .collection(FirestoreCollection.Events)
    .where('status', '==', 'listed')
    .get();

  // Filter events occurring within the next 3 months: [today, maxDate]
  // Includes events that start within the window, or ongoing multi-day events that started before today and end >= today
  const upcomingEvents: IlcEvent[] = [];
  for (const doc of eventsSnap.docs) {
    const evt = firestoreDocToIlcEvent(doc);
    const { start, end } = resolveEventDates(evt);
    if (start && start <= maxDate && end >= today) {
      upcomingEvents.push(evt);
    }
  }

  // Sort chronologically ascending by start date
  upcomingEvents.sort((a, b) => {
    const { start: aStart } = resolveEventDates(a);
    const { start: bStart } = resolveEventDates(b);
    return aStart.localeCompare(bStart);
  });

  if (upcomingEvents.length === 0) {
    logger.info(`[EventDigest] No upcoming listed events found in the next 3 months (${today} to ${maxDate}); skipping ${frequency} digest.`);
    return 0;
  }

  // 2. Query opted-in members
  const membersSnap = await db
    .collection(FirestoreCollection.Members)
    .where('notificationSettings.eventDigestFrequency', '==', frequency)
    .get();

  if (membersSnap.empty) {
    logger.info(`[EventDigest] No members opted into ${frequency} event digest.`);
    return 0;
  }

  // 3. Load templates (custom overrides or defaults)
  const templateSnap = await db.doc('system/email-templates').get();
  const customTemplates = templateSnap.exists ? (templateSnap.data() as Partial<EmailTemplates>) : {};
  const defaults = initEmailTemplates();

  const itemTpl = customTemplates.eventDigestItemTemplate || defaults.eventDigestItemTemplate;
  const overallSubjectTpl = customTemplates.eventDigestOverallSubject || defaults.eventDigestOverallSubject;
  const overallBodyTpl = customTemplates.eventDigestOverallBody || defaults.eventDigestOverallBody;

  // 4. Compile {eventsList} by formatting each event card
  const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
  const compiledEventItems = upcomingEvents.map((evt) => {
    const itemContext = formatEventDigestItemContext(evt, appBase);
    return formatTemplate(itemTpl, itemContext);
  });

  const eventsListMarkdown = compiledEventItems.join('\n\n');

  // 5. Fan out to recipients
  const calendarUrl = `${appBase}/events`;
  const preferencesUrl = `${appBase}/settings/notifications`;
  const batch = db.batch();
  let count = 0;

  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member;
    const recipientEmail = (member.emails || []).find((e) => e && e.includes('@'));
    if (!recipientEmail) continue;

    const replacements: Record<string, string> = {
      name: member.name || 'ILC Member',
      period: periodLabel,
      eventsCount: String(upcomingEvents.length),
      eventsList: eventsListMarkdown,
      calendarUrl,
      preferencesUrl,
      appBase,
    };

    const subject = formatTemplate(overallSubjectTpl, replacements);
    const bodyMarkdown = formatTemplate(overallBodyTpl, replacements);
    const htmlBody = markdownToHtml(bodyMarkdown);

    const mailRef = db.collection(FirestoreCollection.Mail).doc();
    batch.set(mailRef, {
      to: [recipientEmail.trim().toLowerCase()],
      from: fromAddress,
      replyTo: environment.email?.contact || fromAddress,
      status: isPaused ? MailDeliveryState.Paused : MailDeliveryState.Pending,
      delivery: {
        state: isPaused ? MailDeliveryState.Paused : MailDeliveryState.Pending,
        attempts: 0,
        error: null,
      },
      templateKey: 'eventDigestOverall',
      templateData: replacements,
      message: {
        subject: isPaused ? `[Queued / Paused] Upcoming Events Digest` : subject,
        text: isPaused ? '' : bodyMarkdown,
        html: isPaused ? '' : htmlBody,
      },
      metadata: {
        templateKey: 'eventDigestOverall',
        frequency,
        sentAt: new Date().toISOString(),
        ...(isPaused ? { paused: true } : {}),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    count++;
  }

  if (count > 0) {
    await batch.commit();
  }

  logger.info(`[EventDigest] Successfully enqueued ${count} ${frequency} digest emails.`);
  return count;
}
