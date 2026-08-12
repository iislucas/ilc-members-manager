/* get-playback-session.ts
 *
 * Callable Cloud Function to verify user entitlements and generate an authorized
 * video streaming playback session.
 *
 * Checks access against:
 * 1. Admin status
 * 2. Public access tier
 * 3. Individual video grants (Stripe one-off purchases or admin grants)
 * 4. Active ILC Membership (for MembersOnly tier)
 * 5. Active Instructor License (for InstructorsOnly tier)
 * 6. Active Class Video Library Subscription (for ClassVideoSubscribers tier)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins, getMemberByEmail, hasActiveMembership } from '../common';
import {
  VideoItem,
  VodAccessTier,
  VodStatus,
  firestoreDocToVideoItem,
  Member,
} from '../data-model';

export interface GetPlaybackSessionRequest {
  videoId: string;
}

export interface GetPlaybackSessionResponse {
  authorized: boolean;
  manifestUrl?: string;
  title?: string;
  durationSeconds?: number;
  reason?: 'unauthenticated' | 'subscription_required' | 'instructor_required' | 'class_sub_required' | 'purchase_required';
  priceCents?: number;
  stripePriceId?: string;
}

export const getVideoPlaybackSession = onCall(
  { cors: allowedOrigins },
  async (request): Promise<GetPlaybackSessionResponse> => {
    const data = request.data as GetPlaybackSessionRequest;
    if (!data || !data.videoId) {
      throw new HttpsError('invalid-argument', 'videoId is required.');
    }

    const db = admin.firestore();
    const videoRef = db.collection('videos').doc(data.videoId);
    const videoSnap = await videoRef.get();

    if (!videoSnap.exists) {
      throw new HttpsError('not-found', 'Video not found in catalog.');
    }

    const video: VideoItem = firestoreDocToVideoItem(videoSnap);

    if (video.vodStatus !== VodStatus.Ready) {
      throw new HttpsError(
        'failed-precondition',
        'Video is not ready for streaming playback.',
      );
    }

    // 1. Public tier is accessible to all viewers (including unauthenticated)
    if (video.accessTier === VodAccessTier.Public) {
      return {
        authorized: true,
        manifestUrl: video.manifestUrl,
        title: video.title,
        durationSeconds: video.durationSeconds,
      };
    }

    // Gated tiers require authentication
    if (!request.auth || !request.auth.token.email) {
      return {
        authorized: false,
        reason: 'unauthenticated',
        priceCents: video.priceCents,
        stripePriceId: video.stripePriceId,
      };
    }

    const email = request.auth.token.email.toLowerCase();

    // Check if admin
    let member: Member | null = null;
    try {
      member = await getMemberByEmail(email, db);
    } catch {
      // Member record might not be linked yet
    }

    if (member && member.isAdmin) {
      return {
        authorized: true,
        manifestUrl: video.manifestUrl,
        title: video.title,
        durationSeconds: video.durationSeconds,
      };
    }

    // Check individual video grants (if member bought this specific video)
    if (member) {
      const grantRef = db
        .collection('members')
        .doc(member.docId)
        .collection('videoGrants')
        .doc(video.docId);
      const grantSnap = await grantRef.get();
      if (grantSnap.exists) {
        const grantData = grantSnap.data();
        const expiresAt = grantData?.expiresAt;
        if (!expiresAt || new Date(expiresAt) >= new Date()) {
          return {
            authorized: true,
            manifestUrl: video.manifestUrl,
            title: video.title,
            durationSeconds: video.durationSeconds,
          };
        }
      }
    }

    // Also check global video_grants by email
    const globalGrantsQuery = await db
      .collection('video_grants')
      .where('videoId', '==', video.docId)
      .where('memberEmail', '==', email)
      .limit(1)
      .get();

    if (!globalGrantsQuery.empty) {
      const grantData = globalGrantsQuery.docs[0].data();
      const expiresAt = grantData?.expiresAt;
      if (!expiresAt || new Date(expiresAt) >= new Date()) {
        return {
          authorized: true,
          manifestUrl: video.manifestUrl,
          title: video.title,
          durationSeconds: video.durationSeconds,
        };
      }
    }

    // Check tier-specific permissions
    const today = new Date().toISOString().split('T')[0];

    switch (video.accessTier) {
      case VodAccessTier.MembersOnly:
        if (member && hasActiveMembership(member)) {
          return {
            authorized: true,
            manifestUrl: video.manifestUrl,
            title: video.title,
            durationSeconds: video.durationSeconds,
          };
        }
        return {
          authorized: false,
          reason: 'subscription_required',
          priceCents: video.priceCents,
          stripePriceId: video.stripePriceId,
        };

      case VodAccessTier.InstructorsOnly:
        if (
          member &&
          member.instructorLicenseExpires &&
          member.instructorLicenseExpires >= today
        ) {
          return {
            authorized: true,
            manifestUrl: video.manifestUrl,
            title: video.title,
            durationSeconds: video.durationSeconds,
          };
        }
        return {
          authorized: false,
          reason: 'instructor_required',
          priceCents: video.priceCents,
          stripePriceId: video.stripePriceId,
        };

      case VodAccessTier.ClassVideoSubscribers:
        if (
          member &&
          member.classVideoLibrarySubscription &&
          member.classVideoLibraryExpirationDate &&
          member.classVideoLibraryExpirationDate >= today
        ) {
          return {
            authorized: true,
            manifestUrl: video.manifestUrl,
            title: video.title,
            durationSeconds: video.durationSeconds,
          };
        }
        return {
          authorized: false,
          reason: 'class_sub_required',
          priceCents: video.priceCents,
          stripePriceId: video.stripePriceId,
        };

      case VodAccessTier.DirectPurchase:
      default:
        return {
          authorized: false,
          reason: 'purchase_required',
          priceCents: video.priceCents,
          stripePriceId: video.stripePriceId,
        };
    }
  },
);
