import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { environment } from './environment/environment';
import { EmailTemplates, initEmailTemplates } from './data-model/content-cache';
import { formatTemplate, markdownToHtml } from './email-markdown';
import { Member } from './data-model/members';
import { IlcEvent } from './data-model/events';
import { FirestoreCollection } from './data-model/collections';
import { MailSettings, MailSendingStatus } from './data-model/mail';

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
 * Helper to resolve start and end date strings (YYYY-MM-DD) from an event document.
 */
export function resolveEventDates(evt: IlcEvent | Record<string, any>): { start: string; end: string } {
  const startRaw = evt.start || (evt as any).startDate || '';
  const endRaw = evt.end || (evt as any).endDate || '';
  const start = typeof startRaw === 'string' ? startRaw.split('T')[0] : '';
  const end = typeof endRaw === 'string' ? endRaw.split('T')[0] : '';
  return { start, end: end || start };
}

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
    .collection('events')
    .where('status', '==', 'listed')
    .get();

  // Filter events occurring within the next 3 months: [today, maxDate]
  // Includes events that start within the window, or ongoing multi-day events that started before today and end >= today
  const upcomingEvents: Array<{ docId: string; data: IlcEvent }> = [];
  for (const doc of eventsSnap.docs) {
    const raw = doc.data() as IlcEvent;
    const { start, end } = resolveEventDates(raw);
    if (start && start <= maxDate && end >= today) {
      upcomingEvents.push({
        docId: raw.docId || doc.id,
        data: raw,
      });
    }
  }

  // Sort chronologically ascending by start date
  upcomingEvents.sort((a, b) => {
    const { start: aStart } = resolveEventDates(a.data);
    const { start: bStart } = resolveEventDates(b.data);
    return aStart.localeCompare(bStart);
  });

  if (upcomingEvents.length === 0) {
    logger.info(`[EventDigest] No upcoming listed events found in the next 3 months (${today} to ${maxDate}); skipping ${frequency} digest.`);
    return 0;
  }

  // 2. Query opted-in members
  const membersSnap = await db
    .collection('members')
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
  const compiledEventItems = upcomingEvents.map(({ docId, data: evt }) => {
    const eventDocId = evt.docId || docId;
    const { start: startDate, end: endDate } = resolveEventDates(evt);
    const dates =
      startDate === endDate || !endDate
        ? startDate || ''
        : `${startDate} - ${endDate}`;
    const hasOnline = Boolean(evt.onlineJoiningLink && evt.onlineJoiningLink.trim());
    const hasInPerson = Boolean(
      (evt.location && evt.location.trim()) ||
      (evt.inPersonDetailsMarkdown && evt.inPersonDetailsMarkdown.trim())
    );
    const attendanceType =
      hasInPerson && hasOnline
        ? 'In-Person & Online'
        : hasOnline
        ? 'Online'
        : 'In-Person';

    const contactsList = (evt.contacts || []).map((c) => c.name).filter(Boolean);
    if (contactsList.length === 0 && evt.ownerName) {
      contactsList.push(evt.ownerName);
    }
    const instructors = contactsList.join(', ') || 'ILC Instructors';

    const rawDesc = evt.descriptionMarkdown || evt.description || '';
    const cleanDesc = rawDesc.replace(/<[^>]*>?/gm, '').trim();
    const summary = cleanDesc
      ? cleanDesc.length > 200
        ? cleanDesc.slice(0, 197) + '...'
        : cleanDesc
      : '';
    const detailsUrl = `${appBase}/events/${eventDocId}`;

    return formatTemplate(itemTpl, {
      eventTitle: evt.title || 'Untitled Event',
      eventDetailsUrl: detailsUrl,
      eventDates: dates,
      eventLocation: evt.location || (hasOnline ? 'Online' : 'TBD'),
      attendanceType,
      eventInstructors: instructors,
      eventPrice: evt.productId ? 'Paid' : 'Free / Included',
      eventSummary: summary,
      appBase,
    });
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
      status: isPaused ? 'PAUSED' : 'PENDING',
      delivery: {
        state: isPaused ? 'PAUSED' : 'PENDING',
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
