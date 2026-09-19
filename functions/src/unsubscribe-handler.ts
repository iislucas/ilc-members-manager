import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FirestoreCollection } from './data-model/collections';
import { Member } from './data-model/members';
import { EventDigestFrequency, EmailCategory } from './data-model/notifications';
import { TransactionalEmailKey } from './data-model/mail';
import { verifyUnsubscribeToken, getUnsubscribeSecret } from './unsubscribe-token';
import { environment } from './environment/environment';
import { getEmailCategory } from './email-dispatcher';

export function getCategoryLabel(kindOrCategory: string): string {
  switch (kindOrCategory) {
    case 'eventDigest':
    case 'eventDigestOverall':
    case EmailCategory.Events:
      return 'Upcoming Events Digest';
    case TransactionalEmailKey.OrderConfirmation:
      return 'Order Receipts & Confirmations';
    case TransactionalEmailKey.SubscriptionRenewal:
      return 'Subscription Renewal Receipts';
    case TransactionalEmailKey.EventRegistrationConfirmation:
      return 'Event & Workshop Registration Confirmations';
    case TransactionalEmailKey.VodPurchaseConfirmation:
      return 'Video on Demand Confirmations';
    case TransactionalEmailKey.VodGiftReceived:
      return 'Video Gifts & Grants';
    case TransactionalEmailKey.GradingPaymentConfirmation:
      return 'Grading Assessment Payment Confirmations';
    case TransactionalEmailKey.GradingRequestReceived:
      return 'Grading Requests (For Instructors)';
    case TransactionalEmailKey.GradingRequestAccepted:
      return 'Grading Request Accepted Notifications';
    case TransactionalEmailKey.GradingRequestDeclined:
      return 'Grading Request Updates';
    case TransactionalEmailKey.GradingPassed:
      return 'Grading Passed Notifications';
    case TransactionalEmailKey.GradingNotPassed:
      return 'Grading Result Feedback';
    case TransactionalEmailKey.MembershipActivated:
      return 'Membership Activation Notifications';
    case TransactionalEmailKey.InstructorLicenseActivated:
      return 'Instructor License Notifications';
    case EmailCategory.Purchases:
      return 'All Purchases & Orders';
    case EmailCategory.Gradings:
      return 'All Grading Notifications';
    case EmailCategory.Account:
      return 'All Account & Membership Updates';
    case 'all':
    case EmailCategory.All:
      return 'All Email Notifications';
    default:
      return 'Email Notifications';
  }
}

export function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderUnsubscribePageHtml(params: {
  title: string;
  heading: string;
  message: string;
  buttonLabel?: string;
  buttonAction?: 'unsubscribe' | 'resubscribe';
  postParams?: Record<string, string>;
  preferencesUrl: string;
  isSuccessState?: boolean;
  extraOptionsHtml?: string;
}): string {
  const { title, heading, message, buttonLabel, buttonAction, postParams, preferencesUrl, isSuccessState, extraOptionsHtml } = params;

  let formHtml = '';
  if (buttonLabel && buttonAction && postParams) {
    const hiddenInputs = Object.entries(postParams)
      .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
      .join('\n');

    formHtml = `
      <form method="POST" action="/unsubscribe" class="action-form">
        ${hiddenInputs}
        <input type="hidden" name="action" value="${escapeHtml(buttonAction)}">
        <button type="submit" class="btn ${buttonAction === 'resubscribe' ? 'btn-secondary' : 'btn-primary'}">
          ${escapeHtml(buttonLabel)}
        </button>
      </form>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | I Liq Chuan</title>
  <style>
    :root {
      --primary: #800000;
      --primary-hover: #9e1b1e;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --success: #16a34a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      max-width: 480px;
      width: 100%;
      padding: 2.5rem 2rem;
      text-align: center;
    }
    .logo-container {
      margin-bottom: 1.5rem;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #fdf2f2;
      color: var(--primary);
      font-weight: 700;
      font-size: 1.25rem;
      border: 2px solid #fed7d7;
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: var(--text);
    }
    p {
      font-size: 0.95rem;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .action-form {
      margin-bottom: 1.5rem;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 0.75rem 1.25rem;
      font-size: 1rem;
      font-weight: 600;
      border-radius: 8px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease-in-out;
      border: none;
    }
    .btn-primary {
      background-color: var(--primary);
      color: #ffffff;
    }
    .btn-primary:hover {
      background-color: var(--primary-hover);
    }
    .btn-secondary {
      background-color: #f1f5f9;
      color: #334155;
      border: 1px solid var(--border);
    }
    .btn-secondary:hover {
      background-color: #e2e8f0;
    }
    .footer-links {
      border-top: 1px solid var(--border);
      padding-top: 1.25rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .footer-links a {
      color: var(--primary);
      text-decoration: none;
      font-weight: 500;
    }
    .footer-links a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <div class="logo-badge">ILC</div>
    </div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${message}</p>
    ${formHtml}
    ${extraOptionsHtml ? `<div class="extra-options" style="margin-top: 1.5rem; border-top: 1px dashed var(--border); padding-top: 1rem;">${extraOptionsHtml}</div>` : ''}
    <div class="footer-links">
      <p style="margin-bottom: 0;">
        <a href="${escapeHtml(preferencesUrl)}">Manage All Notification Preferences</a> • 
        <a href="https://iliqchuan.com">I Liq Chuan</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Internal logic for processing unsubscribe HTTP requests.
 */
export async function handleUnsubscribeRequest(req: any, res: any): Promise<void> {
  const query = (req.query || {}) as Record<string, string>;
  const body = (req.body || {}) as Record<string, string>;

  const mid = (query['mid'] || body['mid'] || '').trim();
  const email = (query['email'] || body['email'] || '').trim().toLowerCase();
  const token = (query['token'] || body['token'] || '').trim();
  const rawCategory = (query['category'] || body['category'] || '').trim();
  const rawKind = (query['kind'] || body['kind'] || '').trim();
  const action = (query['action'] || body['action'] || 'unsubscribe').trim();

  const isAll = rawKind === 'all' || rawCategory === 'all';
  const isCategory = !isAll && !!rawCategory;
  const kind = isAll ? 'all' : isCategory ? '' : (rawKind || 'eventDigest');
  const category = (isAll ? 'all' : isCategory ? rawCategory : getEmailCategory(kind)) as EmailCategory;

  const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
  const preferencesUrl = `${appBase}/notifications/settings`;
  const categoryLabel = isAll
    ? 'All Email Notifications'
    : isCategory
      ? getCategoryLabel(category)
      : getCategoryLabel(kind);

  if (!token) {
    res.status(400).send(
      renderUnsubscribePageHtml({
        title: 'Missing Link Details',
        heading: 'Invalid Unsubscribe Link',
        message: 'This unsubscribe link is incomplete. If you wish to update your email preferences, please visit your account.',
        preferencesUrl,
      }),
    );
    return;
  }

  const db = admin.firestore();
  const secret = await getUnsubscribeSecret(db);

  // Locate the member document either by mid or by email
  let memberDoc: admin.firestore.DocumentSnapshot | null = null;
  let memberDocRef: admin.firestore.DocumentReference | null = null;

  if (mid) {
    const docSnap = await db.collection(FirestoreCollection.Members).doc(mid).get();
    if (docSnap.exists) {
      memberDoc = docSnap;
      memberDocRef = docSnap.ref;
    }
  }

  if (!memberDoc && email) {
    const snap = await db
      .collection(FirestoreCollection.Members)
      .where('emails', 'array-contains', email)
      .limit(1)
      .get();
    if (!snap.empty) {
      memberDoc = snap.docs[0];
      memberDocRef = snap.docs[0].ref;
    }
  }

  // Validate the token against mid or email
  const isMidValid = mid ? verifyUnsubscribeToken(mid, token, secret) : false;
  const isEmailValid = email ? verifyUnsubscribeToken(email, token, secret) : false;

  if (!isMidValid && !isEmailValid) {
    logger.warn(`[Unsubscribe] Invalid token for mid="${mid}", email="${email}", kind="${kind}", category="${rawCategory}".`);
    res.status(403).send(
      renderUnsubscribePageHtml({
        title: 'Invalid Link',
        heading: 'Invalid or Expired Link',
        message: 'This unsubscribe link is invalid or expired. To manage your email notifications safely, please sign in to your account.',
        preferencesUrl,
      }),
    );
    return;
  }

  const memberData = (memberDoc?.data() || {}) as Member;
  const recipientDisplay = email || (memberData.emails || [])[0] || 'your email';

  // Build secondary option forms for broader unsubscriptions
  let extraOptionsHtml = '';
  const postParamsBase: Record<string, string> = { token };
  if (mid) postParamsBase['mid'] = mid;
  if (email) postParamsBase['email'] = email;

  if (!isAll) {
    const allForm = `
      <form method="POST" action="/unsubscribe" style="margin-top: 0.5rem;">
        ${Object.entries(postParamsBase).map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('\n')}
        <input type="hidden" name="kind" value="all">
        <input type="hidden" name="action" value="unsubscribe">
        <button type="submit" class="btn btn-secondary" style="font-size: 0.85rem; padding: 0.5rem 0.8rem; margin-top: 0.25rem;">
          Unsubscribe from All Portal Emails
        </button>
      </form>
    `;

    if (!isCategory && category && category !== EmailCategory.All) {
      const categoryClassLabel = getCategoryLabel(category);
      const catForm = `
        <form method="POST" action="/unsubscribe" style="margin-top: 0.5rem;">
          ${Object.entries(postParamsBase).map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('\n')}
          <input type="hidden" name="category" value="${escapeHtml(category)}">
          <input type="hidden" name="action" value="unsubscribe">
          <button type="submit" class="btn btn-secondary" style="font-size: 0.85rem; padding: 0.5rem 0.8rem; margin-top: 0.25rem;">
            Unsubscribe from ${escapeHtml(categoryClassLabel)}
          </button>
        </form>
      `;
      extraOptionsHtml = `<p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">Looking for broader options?</p>${catForm}${allForm}`;
    } else {
      extraOptionsHtml = `<p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">Looking for broader options?</p>${allForm}`;
    }
  }

  // Check if RFC 8058 automated one-click POST from Gmail/Yahoo
  const isRfc8058 =
    req.method === 'POST' &&
    (body['List-Unsubscribe'] === 'One-Click' ||
      req.headers['list-unsubscribe'] === 'One-Click' ||
      req.headers['content-type']?.includes('application/x-www-form-urlencoded'));

  const activePostParams: Record<string, string> = { ...postParamsBase };
  if (isCategory) {
    activePostParams['category'] = rawCategory;
  } else {
    activePostParams['kind'] = kind;
  }

  if (req.method === 'POST') {
    const isResubscribe = action === 'resubscribe';
    const settings = memberData.notificationSettings || { pushEnabled: {}, homeEnabled: {} };

    if (memberDocRef) {
      if (isResubscribe) {
        if (isAll) {
          settings.globalEmailEnabled = true;
          settings.eventDigestFrequency = EventDigestFrequency.Monthly;
        } else if (isCategory) {
          settings.categoryEmailEnabled = {
            ...settings.categoryEmailEnabled,
            [category]: true,
          };
          if (category === EmailCategory.Events) {
            settings.eventDigestFrequency = EventDigestFrequency.Monthly;
          }
        } else if (kind === 'eventDigest' || kind === 'eventDigestOverall') {
          settings.eventDigestFrequency = EventDigestFrequency.Monthly;
        } else {
          settings.emailEnabled = {
            ...settings.emailEnabled,
            [kind as TransactionalEmailKey]: true,
          };
        }
      } else {
        // Unsubscribe
        if (isAll) {
          settings.globalEmailEnabled = false;
          settings.eventDigestFrequency = EventDigestFrequency.None;
        } else if (isCategory) {
          settings.categoryEmailEnabled = {
            ...settings.categoryEmailEnabled,
            [category]: false,
          };
          if (category === EmailCategory.Events) {
            settings.eventDigestFrequency = EventDigestFrequency.None;
          }
        } else if (kind === 'eventDigest' || kind === 'eventDigestOverall') {
          settings.eventDigestFrequency = EventDigestFrequency.None;
        } else {
          settings.emailEnabled = {
            ...settings.emailEnabled,
            [kind as TransactionalEmailKey]: false,
          };
        }
      }

      await memberDocRef.update({
        notificationSettings: settings,
      });

      logger.info(
        `[Unsubscribe] Member ${memberDocRef.id} (${recipientDisplay}) ${isResubscribe ? 'resubscribed to' : 'unsubscribed from'} ${isCategory ? `category:${category}` : kind}.`,
      );
    }

    if (isRfc8058 && !req.headers['accept']?.includes('text/html')) {
      res.status(200).send(isResubscribe ? 'Re-subscribed successfully.' : 'Unsubscribed successfully.');
      return;
    }

    // Render HTML response for browser form POSTs
    if (isResubscribe) {
      res.status(200).send(
        renderUnsubscribePageHtml({
          title: 'Re-subscribed',
          heading: 'Subscription Restored',
          message: `You have successfully re-subscribed to <strong>${escapeHtml(categoryLabel)}</strong> for ${escapeHtml(recipientDisplay)}.`,
          buttonLabel: 'Unsubscribe Again',
          buttonAction: 'unsubscribe',
          postParams: activePostParams,
          preferencesUrl,
          isSuccessState: true,
          extraOptionsHtml: isAll ? undefined : extraOptionsHtml,
        }),
      );
    } else {
      res.status(200).send(
        renderUnsubscribePageHtml({
          title: 'Unsubscribed',
          heading: 'Unsubscribed Successfully',
          message: `You will no longer receive <strong>${escapeHtml(categoryLabel)}</strong> at ${escapeHtml(recipientDisplay)}.`,
          buttonLabel: 'Undo / Re-subscribe',
          buttonAction: 'resubscribe',
          postParams: activePostParams,
          preferencesUrl,
          isSuccessState: true,
          extraOptionsHtml: isAll ? undefined : extraOptionsHtml,
        }),
      );
    }
    return;
  }

  // GET Request: Render confirmation landing page (protecting against automatic scanner GET requests)
  const currentSettings = memberData.notificationSettings;
  let isCurrentlySubscribed = true;

  if (currentSettings?.globalEmailEnabled === false) {
    isCurrentlySubscribed = false;
  } else if (isAll) {
    isCurrentlySubscribed = true;
  } else if (isCategory) {
    isCurrentlySubscribed = currentSettings?.categoryEmailEnabled?.[category] !== false;
    if (category === EmailCategory.Events) {
      isCurrentlySubscribed =
        isCurrentlySubscribed &&
        (currentSettings?.eventDigestFrequency === EventDigestFrequency.Weekly ||
          currentSettings?.eventDigestFrequency === EventDigestFrequency.Monthly);
    }
  } else if (kind === 'eventDigest' || kind === 'eventDigestOverall') {
    isCurrentlySubscribed =
      currentSettings?.categoryEmailEnabled?.[EmailCategory.Events] !== false &&
      (currentSettings?.eventDigestFrequency === EventDigestFrequency.Weekly ||
        currentSettings?.eventDigestFrequency === EventDigestFrequency.Monthly);
  } else {
    isCurrentlySubscribed =
      currentSettings?.categoryEmailEnabled?.[category] !== false &&
      currentSettings?.emailEnabled?.[kind as TransactionalEmailKey] !== false;
  }

  if (!isCurrentlySubscribed) {
    res.status(200).send(
      renderUnsubscribePageHtml({
        title: 'Already Unsubscribed',
        heading: 'Already Unsubscribed',
        message: `You are currently unsubscribed from <strong>${escapeHtml(categoryLabel)}</strong> for ${escapeHtml(recipientDisplay)}.`,
        buttonLabel: 'Re-subscribe to These Emails',
        buttonAction: 'resubscribe',
        postParams: activePostParams,
        preferencesUrl,
        extraOptionsHtml: isAll ? undefined : extraOptionsHtml,
      }),
    );
    return;
  }

  res.status(200).send(
    renderUnsubscribePageHtml({
      title: `Unsubscribe from ${categoryLabel}`,
      heading: `Unsubscribe from ${categoryLabel}`,
      message: `Click below to stop receiving <strong>${escapeHtml(categoryLabel)}</strong> at <strong>${escapeHtml(recipientDisplay)}</strong>.`,
      buttonLabel: 'Confirm Unsubscribe',
      buttonAction: 'unsubscribe',
      postParams: activePostParams,
      preferencesUrl,
      extraOptionsHtml: isAll ? undefined : extraOptionsHtml,
    }),
  );
}

/**
 * Public HTTP Cloud Function that processes one-click email unsubscribes.
 * Handles both RFC 8058 automated POST requests and human browser GET/POST interactions.
 */
export const unsubscribeHandler = onRequest({ cors: true }, handleUnsubscribeRequest);
