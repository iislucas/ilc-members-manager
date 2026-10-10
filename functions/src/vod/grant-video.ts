/* grant-video.ts
 *
 * Admin-only Callable Cloud Function to grant access to a video or video series
 * to a member or any email address (the recipient need not have a member
 * record; playback finds the grant in the global video_grants collection by
 * email).
 *
 * Every grant written here is a VideoGrantKind.AdminGrant. Paid member-to-member
 * gifts are a separate Stripe flow (VideoGrantKind.GiftPurchase).
 *
 * When `sendNotification` is not false, the recipient is notified with an
 * admin-authored message: in-app (only if they have a member record) and by
 * the `vodAccessGranted` transactional email (unless that email is turned Off).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { assertAdmin, allowedOrigins, getMemberByEmail } from '../common';
import { FirestoreCollection, FirestoreSubcollection } from '../data-model/collections';
import {
  GRANT_MESSAGE_PLACEHOLDERS,
  GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH,
  fillGrantMessagePlaceholders,
  normalizeGrantExpiry,
  GrantVideoAccessRequest,
  GrantVideoAccessResponse,
  VideoGrant,
  VideoGrantKind,
  firestoreDocToVideoItem,
} from '../data-model/vod';
import { NotificationKind } from '../data-model/notifications';
import { createMemberNotification } from '../notifications';
import { Member } from '../data-model/members';
import { sendTransactionalEmail } from '../email-dispatcher';
import { environment } from '../environment/environment';
import { MailSettings, MailSendingStatus, TransactionalEmailKey, resolveNotificationStatus } from '../data-model/mail';

export const grantVideoAccess = onCall(
  { cors: allowedOrigins },
  async (request): Promise<GrantVideoAccessResponse> => {
    await assertAdmin(request);

    const data = request.data as GrantVideoAccessRequest;
    if (!data || !data.targetId || !data.targetType) {
      throw new HttpsError('invalid-argument', 'targetId and targetType are required.');
    }

    const recipientEmail = (data.recipientEmail || '').trim().toLowerCase();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new HttpsError('invalid-argument', 'A valid recipient email is required.');
    }

    const sendNotification = data.sendNotification !== false;
    // The recipient-facing message is ignored when not notifying.
    const customMessage = sendNotification ? (data.notificationMessage || '').trim() : '';
    if (customMessage.length > GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH) {
      throw new HttpsError(
        'invalid-argument',
        `The notification message must be at most ${GRANT_NOTIFICATION_MESSAGE_MAX_LENGTH} characters.`,
      );
    }

    // Validate the optional expiry up front, before any writes.
    let expiresAt: string | undefined;
    try {
      expiresAt = normalizeGrantExpiry(data.expiresAt);
    } catch (err: unknown) {
      throw new HttpsError('invalid-argument', err instanceof Error ? err.message : 'Invalid expiry date.');
    }

    const db = admin.firestore();

    // Resolve caller admin's member record (for grantedByMemberDocId).
    const callerEmail = request.auth?.token.email?.toLowerCase();
    let adminMember: Member | null = null;
    if (callerEmail) {
      try {
        adminMember = await getMemberByEmail(callerEmail, db);
      } catch {
        // Continue if admin lookup fails
      }
    }
    const adminMemberDocId = adminMember?.docId || '';

    // Resolve recipient member if possible
    let recipientMember: Member | null = null;
    if (data.recipientMemberDocId) {
      const snap = await db.collection(FirestoreCollection.Members).doc(data.recipientMemberDocId).get();
      if (snap.exists) {
        recipientMember = { docId: snap.id, ...snap.data() } as Member;
      }
    }
    if (!recipientMember) {
      try {
        recipientMember = await getMemberByEmail(recipientEmail, db);
      } catch {
        // Recipient might not be registered yet
      }
    }

    const recipientMemberDocId = recipientMember?.docId || data.recipientMemberDocId || '';

    const nowIso = new Date().toISOString();

    const targetDocIds = new Set<string>();
    let contentTitle = '';

    if (data.targetType === 'video') {
      const videoSnap = await db.collection(FirestoreCollection.Videos).doc(data.targetId).get();
      if (!videoSnap.exists) {
        throw new HttpsError('not-found', `Video ${data.targetId} not found.`);
      }
      const video = firestoreDocToVideoItem(videoSnap);
      contentTitle = video.title;
      targetDocIds.add(video.docId);
    } else {
      // Series target
      targetDocIds.add(data.targetId);
      // Query videos belonging to this series
      const seriesVideosSnap = await db
        .collection(FirestoreCollection.Videos)
        .where('seriesId', '==', data.targetId)
        .get();

      if (!seriesVideosSnap.empty) {
        for (const doc of seriesVideosSnap.docs) {
          targetDocIds.add(doc.id);
          if (!contentTitle) {
            const v = firestoreDocToVideoItem(doc);
            contentTitle = v.seriesTitle || v.title;
          }
        }
      }
      if (!contentTitle) {
        contentTitle = `Series: ${data.targetId}`;
      }
    }

    let grantedCount = 0;

    for (const targetId of targetDocIds) {
      const grant: VideoGrant = {
        docId: targetId,
        videoId: targetId,
        memberDocId: recipientMemberDocId,
        memberEmail: recipientEmail,
        grantKind: VideoGrantKind.AdminGrant,
        grantedByMemberDocId: adminMemberDocId || undefined,
        notes: data.notes || undefined,
        expiresAt,
        grantedAt: nowIso,
      };

      if (recipientMemberDocId) {
        await db
          .collection(FirestoreCollection.Members)
          .doc(recipientMemberDocId)
          .collection(FirestoreSubcollection.VideoGrants)
          .doc(targetId)
          .set(grant);
      }

      const globalGrantKey = recipientMemberDocId
        ? `${recipientMemberDocId}_${targetId}`
        : `${recipientEmail}_${targetId}`;
      await db
        .collection(FirestoreCollection.VideoGrants)
        .doc(globalGrantKey)
        .set(grant);

      grantedCount++;
    }

    let notifiedInApp = false;
    let emailSent = false;

    if (sendNotification) {
      const recipientDisplayName = recipientMember?.name || data.recipientName || 'there';
      const message = fillGrantMessagePlaceholders(
        customMessage || `You've been given access to **${GRANT_MESSAGE_PLACEHOLDERS.title}**.`,
        { title: contentTitle, name: recipientDisplayName },
      );
      const watchLink = data.targetType === 'video'
        ? `/videos/${data.targetId}`
        : `/videos?series=${data.targetId}`;

      if (recipientMember) {
        await createMemberNotification(db, recipientMember.docId, {
          kind: NotificationKind.VideoAccessGranted,
          // The admin writes the whole message (presets carry their own emoji), so no prefix is added.
          markdown: `${message}\n\n[Watch now](${watchLink})`,
          createdAt: nowIso,
          dismissed: false,
          data: {
            videoId: data.targetType === 'video' ? data.targetId : undefined,
            seriesId: data.targetType === 'series' ? data.targetId : undefined,
            title: contentTitle,
            grantKind: VideoGrantKind.AdminGrant,
            videoUrl: watchLink,
          },
        });
        notifiedInApp = true;
      }

      // sendTransactionalEmail additionally applies per-member opt-outs and
      // the Paused status; here we only skip when the email kind is Off.
      const mailSettingsSnap = await db.doc('system/mail-settings').get();
      const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
      const mailStatus: MailSendingStatus = resolveNotificationStatus(
        mailSettings,
        TransactionalEmailKey.VodAccessGranted,
      );

      if (mailStatus !== MailSendingStatus.Off) {
        try {
          const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
          await sendTransactionalEmail(db, {
            to: recipientEmail,
            templateKey: TransactionalEmailKey.VodAccessGranted,
            replacements: {
              name: recipientMember?.name || data.recipientName || 'ILC Member',
              videoTitle: contentTitle,
              videoUrl: `${appBase}${watchLink}`,
              message,
              appBase,
            },
          });
          emailSent = true;
        } catch (emailErr) {
          logger.error('Failed to send vodAccessGranted email notification for grant', {
            emailErr,
            recipientEmail,
            targetId: data.targetId,
          });
        }
      }
    }

    logger.info('Video access granted by admin', {
      adminEmail: callerEmail,
      recipientEmail,
      recipientMemberDocId,
      targetType: data.targetType,
      targetId: data.targetId,
      grantedCount,
      notifiedInApp,
      emailSent,
    });

    return {
      success: true,
      grantedCount,
      recipientEmail,
      recipientMemberDocId: recipientMemberDocId || undefined,
      notifiedInApp,
      emailSent,
    };
  },
);
