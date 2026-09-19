/* grant-video.ts
 *
 * Admin-only Callable Cloud Function to grant access to a video or video series
 * to a member or email address.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { assertAdmin, allowedOrigins, getMemberByEmail } from '../common';
import { FirestoreCollection, FirestoreSubcollection } from '../data-model/collections';
import { VideoGrant, VideoGrantKind, firestoreDocToVideoItem } from '../data-model/vod';
import { NotificationKind } from '../data-model/notifications';
import { createMemberNotification } from '../notifications';
import { Member } from '../data-model/members';
import { sendTransactionalEmail } from '../email-dispatcher';
import { environment } from '../environment/environment';
import { MailSettings, MailSendingStatus, TransactionalEmailKey, resolveNotificationStatus } from '../data-model/mail';

export interface GrantVideoAccessRequest {
  targetType: 'video' | 'series';
  targetId: string;
  recipientEmail: string;
  recipientMemberDocId?: string;
  recipientName?: string;
  grantKind?: VideoGrantKind;
  notes?: string;
  expiresAt?: string;
  sendNotification?: boolean;
}

export interface GrantVideoAccessResponse {
  success: boolean;
  grantedCount: number;
  recipientEmail: string;
  recipientMemberDocId?: string;
}

export const grantVideoAccess = onCall(
  { cors: allowedOrigins },
  async (request) => {
    await assertAdmin(request);

    const data = request.data as GrantVideoAccessRequest;
    if (!data || !data.targetId || !data.targetType) {
      throw new HttpsError('invalid-argument', 'targetId and targetType are required.');
    }

    const recipientEmail = (data.recipientEmail || '').trim().toLowerCase();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new HttpsError('invalid-argument', 'A valid recipient email is required.');
    }

    const db = admin.firestore();

    // Resolve caller admin info
    const callerEmail = request.auth?.token.email?.toLowerCase();
    let adminMember: Member | null = null;
    if (callerEmail) {
      try {
        adminMember = await getMemberByEmail(callerEmail, db);
      } catch {
        // Continue if admin lookup fails
      }
    }
    const adminName = adminMember?.name || 'Administrator';
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

    // Check mail settings status: if OFF, only allow granting to existing member accounts
    const mailSettingsSnap = await db.doc('system/mail-settings').get();
    const mailSettings = mailSettingsSnap.exists ? (mailSettingsSnap.data() as MailSettings) : undefined;
    const mailStatus: MailSendingStatus = resolveNotificationStatus(
      mailSettings,
      TransactionalEmailKey.VodGiftReceived,
    );

    if (mailStatus === MailSendingStatus.Off && !recipientMember) {
      throw new HttpsError(
        'failed-precondition',
        'Email notifications are currently turned off. Access can only be granted to existing member accounts.',
      );
    }

    const grantKind = data.grantKind || VideoGrantKind.AdminGrant;
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
        grantKind,
        grantedByMemberDocId: adminMemberDocId || undefined,
        giftedByMemberDocId: adminMemberDocId || undefined,
        giftedByName: adminName,
        giftedByEmail: callerEmail || undefined,
        notes: data.notes || undefined,
        expiresAt: data.expiresAt || undefined,
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

    const sendNotification = data.sendNotification !== false;

    if (sendNotification && recipientMemberDocId) {
      const kindLabel = grantKind === VideoGrantKind.Complimentary
        ? 'complimentary access'
        : grantKind === VideoGrantKind.GiftPurchase
        ? 'gifted access'
        : 'access';

      const watchLink = data.targetType === 'video'
        ? `/videos/${data.targetId}`
        : `/videos?series=${data.targetId}`;

      const notesSnippet = data.notes ? `\n\n> "${data.notes}"` : '';
      const icon = grantKind === VideoGrantKind.GiftPurchase ? '🎁' : '🎬';

      await createMemberNotification(db, recipientMemberDocId, {
        kind: NotificationKind.VideoAccessGranted,
        markdown: `${icon} You have been granted ${kindLabel} to [**${contentTitle}**](${watchLink})!${notesSnippet}`,
        createdAt: nowIso,
        dismissed: false,
        data: {
          videoId: data.targetType === 'video' ? data.targetId : undefined,
          seriesId: data.targetType === 'series' ? data.targetId : undefined,
          title: contentTitle,
          grantKind,
          giftedByName: adminName,
          giftMessage: data.notes || undefined,
          videoUrl: watchLink,
        },
      });
    }

    // Send transactional email notification to recipient if notifications enabled
    // Note: sendTransactionalEmail checks user opt-out preferences and global email settings
    if (sendNotification && recipientEmail) {
      try {
        const appBase = environment.links?.appBase || 'https://app.iliqchuan.com';
        const watchUrl = data.targetType === 'video'
          ? `${appBase}/videos/${data.targetId}`
          : `${appBase}/videos?series=${data.targetId}`;

        await sendTransactionalEmail(db, {
          to: recipientEmail,
          templateKey: TransactionalEmailKey.VodGiftReceived,
          replacements: {
            name: recipientMember?.name || data.recipientName || 'ILC Member',
            giverName: adminName,
            videoTitle: contentTitle,
            videoUrl: watchUrl,
            giftMessage: data.notes || (
              grantKind === VideoGrantKind.GiftPurchase
                ? 'Enjoy your video gift!'
                : grantKind === VideoGrantKind.Complimentary
                ? 'Complimentary access has been granted to your account.'
                : 'Access has been granted to your account.'
            ),
            appBase,
          },
        });
      } catch (emailErr) {
        logger.error('Failed to send vodGiftReceived email notification for grant', {
          emailErr,
          recipientEmail,
          targetId: data.targetId,
        });
      }
    }

    logger.info('Video access granted by admin', {
      adminEmail: callerEmail,
      recipientEmail,
      recipientMemberDocId,
      targetType: data.targetType,
      targetId: data.targetId,
      grantedCount,
    });

    return {
      success: true,
      grantedCount,
      recipientEmail,
      recipientMemberDocId: recipientMemberDocId || undefined,
    };
  },
);
