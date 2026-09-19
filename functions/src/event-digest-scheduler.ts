import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { environment } from './environment/environment';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';
import { formatTemplate, markdownToHtml } from './email-markdown';
import { Member } from './data-model/members';
import {
  IlcEvent,
  resolveEventDates,
  formatEventDigestItemContext,
  firestoreDocToIlcEvent,
  EventDigestItemContext,
  EventDigestOverallContext,
} from './data-model/events';
import { FirestoreCollection } from './data-model/collections';
import {
  MailSettings,
  MailSendingStatus,
  MailDeliveryState,
  TransactionalEmailKey,
  resolveNotificationStatus,
} from './data-model/mail';
import { EventDigestFrequency } from './data-model/notifications';
import { getUnsubscribeSecret, generateUnsubscribeToken } from './unsubscribe-token';

export { resolveEventDates, formatEventDigestItemContext, EventDigestItemContext, EventDigestOverallContext };

/**
 * Weekly upcoming events digest: runs every Monday at 08:00 UTC.
 */
export const sendWeeklyEventDigest = onSchedule(
  { schedule: '0 8 * * 1', timeZone: 'UTC' },
  async () => {
    const db = admin.firestore();
    await processEventDigest(db, EventDigestFrequency.Weekly, 'the next 3 months');
  },
);

/**
 * Monthly upcoming events digest: runs on the 1st of every month at 08:00 UTC.
 */
export const sendMonthlyEventDigest = onSchedule(
  { schedule: '0 8 1 * *', timeZone: 'UTC' },
  async () => {
    const db = admin.firestore();
    await processEventDigest(db, EventDigestFrequency.Monthly, 'the next 3 months');
  },
);

/**
 * Queries upcoming listed events occurring within [today, maxDate] and sorts them chronologically.
 */
export async function getUpcomingDigestEvents(
  db: admin.firestore.Firestore,
  today: string,
  maxDate: string,
): Promise<IlcEvent[]> {
  const eventsSnap = await db
    .collection(FirestoreCollection.Events)
    .where('status', '==', 'listed')
    .get();

  const upcomingEvents: IlcEvent[] = [];
  for (const doc of eventsSnap.docs) {
    const evt = firestoreDocToIlcEvent(doc);
    const { start, end } = resolveEventDates(evt);
    if (start && start <= maxDate && end >= today) {
      upcomingEvents.push(evt);
    }
  }

  upcomingEvents.sort((a, b) => {
    const { start: aStart } = resolveEventDates(a);
    const { start: bStart } = resolveEventDates(b);
    return aStart.localeCompare(bStart);
  });

  return upcomingEvents;
}

/**
 * Retrieves members who opted into the specified digest frequency.
 */
export async function getOptedInMembers(
  db: admin.firestore.Firestore,
  frequency: EventDigestFrequency,
): Promise<Array<{ docId: string; member: Member }>> {
  const membersSnap = await db
    .collection(FirestoreCollection.Members)
    .where('notificationSettings.eventDigestFrequency', '==', frequency)
    .get();

  return membersSnap.docs.map((doc) => ({
    docId: doc.id,
    member: doc.data() as Member,
  }));
}

/**
 * Formats each event using the item template and joins them into markdown.
 */
export function compileDigestMarkdown(
  upcomingEvents: IlcEvent[],
  itemTpl: string,
  appBase: string,
): string {
  const compiledEventItems = upcomingEvents.map((evt) => {
    const itemContext = formatEventDigestItemContext(evt, appBase);
    return formatTemplate(itemTpl, itemContext);
  });
  return compiledEventItems.join('\n\n');
}

export interface EnqueueDigestBatchOptions {
  recipients: Array<{ docId: string; member: Member }>;
  upcomingEventsCount: number;
  eventsListMarkdown: string;
  periodLabel: string;
  frequency: EventDigestFrequency;
  overallSubjectTpl: string;
  overallBodyTpl: string;
  fromAddress: string;
  isPaused: boolean;
  appBase: string;
  unsubscribeSecret: string;
}

/**
 * Fans out digest emails to members in a Firestore batch, attaching RFC 8058 headers and unsubscribe links.
 */
export async function enqueueDigestBatch(
  db: admin.firestore.Firestore,
  options: EnqueueDigestBatchOptions,
): Promise<number> {
  const calendarUrl = `${options.appBase}/events`;
  const preferencesUrl = `${options.appBase}/settings/notifications`;
  const batch = db.batch();
  let count = 0;

  for (const { docId, member } of options.recipients) {
    const recipientEmail = (member.emails || []).find((e) => e && e.includes('@'));
    if (!recipientEmail) continue;

    const token = generateUnsubscribeToken(docId, options.unsubscribeSecret);
    const unsubscribeUrl = `${options.appBase}/unsubscribe?mid=${encodeURIComponent(docId)}&token=${encodeURIComponent(token)}&kind=eventDigest`;
    const unsubscribeCategoryUrl = `${options.appBase}/unsubscribe?mid=${encodeURIComponent(docId)}&token=${encodeURIComponent(token)}&category=events`;
    const unsubscribeAllUrl = `${options.appBase}/unsubscribe?mid=${encodeURIComponent(docId)}&token=${encodeURIComponent(token)}&kind=all`;

    const replacements: EventDigestOverallContext = {
      name: member.name || 'ILC Member',
      period: options.periodLabel,
      eventsCount: String(options.upcomingEventsCount),
      eventsList: options.eventsListMarkdown,
      calendarUrl,
      preferencesUrl,
      unsubscribeUrl,
      unsubscribeKindName: 'Upcoming Events Digest',
      unsubscribeCategoryUrl,
      unsubscribeCategoryName: 'All Event Notifications',
      unsubscribeAllUrl,
      appBase: options.appBase,
    };

    const subject = formatTemplate(options.overallSubjectTpl, replacements);
    const bodyMarkdown = formatTemplate(options.overallBodyTpl, replacements);
    const htmlBody = markdownToHtml(bodyMarkdown);

    const mailRef = db.collection(FirestoreCollection.Mail).doc();
    batch.set(mailRef, {
      to: [recipientEmail.trim().toLowerCase()],
      from: options.fromAddress,
      replyTo: environment.email?.contact || options.fromAddress,
      status: options.isPaused ? MailDeliveryState.Paused : MailDeliveryState.Pending,
      delivery: {
        state: options.isPaused ? MailDeliveryState.Paused : MailDeliveryState.Pending,
        attempts: 0,
        error: null,
      },
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      templateKey: 'eventDigestOverall',
      templateData: replacements,
      message: {
        subject: options.isPaused ? `[Queued / Paused] Upcoming Events Digest` : subject,
        text: options.isPaused ? '' : bodyMarkdown,
        html: options.isPaused ? '' : htmlBody,
      },
      metadata: {
        templateKey: 'eventDigestOverall',
        frequency: options.frequency,
        unsubscribeUrl,
        sentAt: new Date().toISOString(),
        ...(options.isPaused ? { paused: true } : {}),
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    count++;
  }

  if (count > 0) {
    await batch.commit();
  }

  return count;
}

/**
 * Core event digest processor. Coordinates date range calculation, querying events,
 * compiling templates, and enqueueing batches with one-click unsubscribe headers.
 */
export async function processEventDigest(
  db: admin.firestore.Firestore,
  frequency: EventDigestFrequency.Weekly | EventDigestFrequency.Monthly,
  periodLabel = 'the next 3 months',
): Promise<number> {
  const fromAddress = environment.email?.from;
  if (!fromAddress) {
    logger.info(`[EventDigest] Outbound email disabled (environment.email.from is empty). Skipping ${frequency} digest.`);
    return 0;
  }

  const mailSettingsSnap = await db.doc('system/mail-settings').get();
  const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
  const status: MailSendingStatus = resolveNotificationStatus(
    mailSettings,
    TransactionalEmailKey.EventDigestOverall,
  );

  if (status === MailSendingStatus.Off) {
    logger.info(`[EventDigest] Mail sending is OFF for ${TransactionalEmailKey.EventDigestOverall}. Skipping ${frequency} digest dispatch.`);
    return 0;
  }

  const isPaused = status === MailSendingStatus.Paused;

  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const future = new Date(now);
  future.setMonth(future.getMonth() + 3);
  const maxDate = future.toISOString().split('T')[0];

  const upcomingEvents = await getUpcomingDigestEvents(db, today, maxDate);
  if (upcomingEvents.length === 0) {
    logger.info(`[EventDigest] No upcoming listed events found in the next 3 months (${today} to ${maxDate}); skipping ${frequency} digest.`);
    return 0;
  }

  const optedInMembers = await getOptedInMembers(db, frequency);
  if (optedInMembers.length === 0) {
    logger.info(`[EventDigest] No members opted into ${frequency} event digest.`);
    return 0;
  }

  const templateSnap = await db.doc('system/email-templates').get();
  const customTemplates = templateSnap.exists ? (templateSnap.data() as Partial<EmailTemplates>) : {};
  const defaults = initEmailTemplates();

  const itemTpl = customTemplates.eventDigestItemTemplate || defaults.eventDigestItemTemplate;
  const overallSubjectTpl = customTemplates.eventDigestOverallSubject || defaults.eventDigestOverallSubject;
  const overallBodyTpl = customTemplates.eventDigestOverallBody || defaults.eventDigestOverallBody;

  const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
  const eventsListMarkdown = compileDigestMarkdown(upcomingEvents, itemTpl, appBase);
  const unsubscribeSecret = await getUnsubscribeSecret(db);

  const count = await enqueueDigestBatch(db, {
    recipients: optedInMembers,
    upcomingEventsCount: upcomingEvents.length,
    eventsListMarkdown,
    periodLabel,
    frequency,
    overallSubjectTpl,
    overallBodyTpl,
    fromAddress,
    isPaused,
    appBase,
    unsubscribeSecret,
  });

  logger.info(`[EventDigest] Successfully enqueued ${count} ${frequency} digest emails.`);
  return count;
}
