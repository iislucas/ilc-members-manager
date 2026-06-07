/*
Web Push sender.

Fires whenever a notification document is created under a member and delivers
a background Web Push message to each of that member's registered devices
(/members/{memberDocId}/pushSubscriptions/{subId}).

Architecture: subscriptions are standards-based Web Push subscriptions created
on the client via Angular's SwPush (which reuses the existing ngsw-worker.js to
receive and display the push). Sending a Web Push message requires VAPID signing
and RFC-8291 payload encryption, which the `web-push` library implements — this
is why we use it rather than admin.messaging() (FCM), whose API targets FCM
registration tokens, not raw PushSubscriptions.

Configuration:
  - environment.vapidPublicKey  — VAPID public key (must match the client's).
  - VAPID_PRIVATE_KEY (secret)  — VAPID private key.
Generate a pair with `pnpm dlx web-push generate-vapid-keys`.
*/

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import webpush from 'web-push';
import {
  Member,
  MemberNotification,
  MemberNotificationSettings,
  NotificationKind,
  PushSubscriptionDoc,
} from './data-model';
import { environment } from './environment/environment';

const vapidPrivateKey = defineSecret('VAPID_PRIVATE_KEY');

// A friendly title per notification kind for the push banner.
function notificationTitle(kind: NotificationKind): string {
  switch (kind) {
    case NotificationKind.GradingRequestAccepted:
      return 'Grading request accepted 🎉';
    case NotificationKind.GradingRequestDeclined:
      return 'Grading request update';
    case NotificationKind.GradingRequestsYouAsInstructor:
      return 'New grading request';
    case NotificationKind.GradingManagerAdded:
      return 'Grading request';
    case NotificationKind.GradingManagerRemoved:
      return 'Grading request update';
    case NotificationKind.GradingPurchased:
      return 'Your grading is ready 🥋';
    case NotificationKind.GradingPassed:
      return 'Congratulations! 🎉';
    case NotificationKind.GradingNotPassed:
      return 'Your grading result 🙏';
    case NotificationKind.BlogPost:
      return 'New post for you';
    case NotificationKind.NewEventPosted:
      return 'New event posted';
    case NotificationKind.PurchaseFulfilled:
      return 'Purchase processed ✅';
    default:
      return 'I Liq Chuan';
  }
}

// Reduce markdown to readable plain text for the push body (push banners do not
// render markdown). Mirrors NotificationService.stripMarkdown on the client.
function stripMarkdown(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
    .replace(/[#*_[\]\-()`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const sendPushOnNotification = onDocumentCreated(
  {
    document: 'members/{memberDocId}/notifications/{notifId}',
    secrets: [vapidPrivateKey],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const publicKey = environment.vapidPublicKey;
    const privateKey = vapidPrivateKey.value();
    if (!publicKey || !privateKey) {
      logger.info('VAPID keys not configured; skipping web push.');
      return;
    }

    const notification = snap.data() as MemberNotification;
    const { memberDocId, notifId } = event.params as { memberDocId: string; notifId: string };

    const db = admin.firestore();

    // Gate on the member's server-side push preferences. Push is opt-in: it is
    // only sent when the member has enabled it account-wide, and not for kinds
    // they have explicitly muted.
    const memberSnap = await db.collection('members').doc(memberDocId).get();
    const settings = (memberSnap.data() as Member | undefined)
      ?.notificationSettings as MemberNotificationSettings | undefined;
    if (settings?.globalPushEnabled !== true) {
      logger.info(`Member ${memberDocId} has push disabled account-wide; skipping push.`);
      return;
    }
    if (settings.pushEnabled?.[notification.kind] === false) {
      logger.info(`Member ${memberDocId} muted push for kind ${notification.kind}; skipping.`);
      return;
    }

    const subsSnap = await db
      .collection('members')
      .doc(memberDocId)
      .collection('pushSubscriptions')
      .get();
    if (subsSnap.empty) return;

    webpush.setVapidDetails(environment.pushContactEmail, publicKey, privateKey);

    // Angular's ngsw-worker.js renders `notification` and uses
    // `data.onActionClick.default` to handle taps (focus an open tab or open one).
    const payload = JSON.stringify({
      notification: {
        title: notificationTitle(notification.kind),
        body: stripMarkdown(notification.markdown),
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-192x192.png',
        data: {
          notifId,
          kind: notification.kind,
          onActionClick: {
            default: { operation: 'focusLastFocusedOrOpen', url: '/#/notifications' },
          },
        },
      },
    });

    const results = await Promise.allSettled(
      subsSnap.docs.map(async (doc) => {
        const sub = doc.data() as PushSubscriptionDoc;
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            payload,
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          // 404/410 mean the subscription is gone/expired — prune it.
          if (statusCode === 404 || statusCode === 410) {
            await doc.ref.delete();
            logger.info(`Pruned expired push subscription ${doc.id} for member ${memberDocId}.`);
          } else {
            logger.error(`web-push send failed for subscription ${doc.id}:`, err);
          }
          throw err;
        }
      }),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    logger.info(`Web push for notification ${notifId}: ${sent}/${subsSnap.size} delivered.`);
  },
);
