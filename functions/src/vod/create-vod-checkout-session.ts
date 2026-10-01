/**
 * Cloud Function: createVodCheckoutSession
 *
 * Creates a Stripe Checkout Session for Video on Demand (VOD) catalog items
 * (either a single video recording or a multi-part series collection) using
 * dynamic line item pricing (`price_data`) configured directly in Firestore.
 *
 * Eliminates manual Stripe product/price creation and sync errors for VOD.
 */

import Stripe from 'stripe';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { allowedOrigins, getMemberByEmail } from '../common';
import { getStripeClient, stripeSecretKey } from '../stripe-common';
import {
  CreateVodCheckoutSessionRequest,
  CreateCheckoutSessionResult,
} from '../stripe-types';
import { FirestoreCollection } from '../data-model/collections';
import { firestoreDocToVideoItem, VideoItem, VodAccessTier } from '../data-model/vod';
import {
  MailSettings,
  MailSendingStatus,
  TransactionalEmailKey,
  resolveNotificationStatus,
} from '../data-model/mail';
import { Member } from '../data-model/members';

function requireAllowedOrigin(origin: unknown): string {
  if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
    throw new HttpsError(
      'invalid-argument',
      'A recognised app origin is required.',
    );
  }
  return origin;
}

export const createVodCheckoutSession = onCall<
  CreateVodCheckoutSessionRequest,
  Promise<CreateCheckoutSessionResult>
>({ cors: allowedOrigins, secrets: [stripeSecretKey] }, async (request) => {
  const data = request.data;
  if (!data) {
    throw new HttpsError('invalid-argument', 'Request payload is required.');
  }

  const origin = requireAllowedOrigin(data.origin);

  const videoId = data.videoId?.trim();
  const seriesId = data.seriesId?.trim();

  if (!videoId && !seriesId) {
    throw new HttpsError(
      'invalid-argument',
      'Either videoId or seriesId must be specified.',
    );
  }

  const db = admin.firestore();
  const isSeries = Boolean(seriesId);

  let productName = '';
  let productDescription = '';
  let unitAmountCents = 0;
  let currency = 'usd';
  let thumbnailUrl: string | undefined;

  if (seriesId) {
    // 1a. Query videos belonging to this series
    let seriesSnap = await db
      .collection(FirestoreCollection.Videos)
      .where('seriesId', '==', seriesId)
      .get();

    if (seriesSnap.empty) {
      seriesSnap = await db
        .collection(FirestoreCollection.Videos)
        .where('forVodPageId', '==', seriesId)
        .get();
    }

    if (seriesSnap.empty) {
      throw new HttpsError('not-found', 'Video series not found.');
    }

    const seriesVideos: VideoItem[] = seriesSnap.docs
      .map((doc) => firestoreDocToVideoItem(doc))
      .sort((a, b) => (a.seriesPartIndex || 0) - (b.seriesPartIndex || 0));

    // Must have at least one published video
    const hasPublished = seriesVideos.some((v) => v.isPublished !== false);
    if (!hasPublished) {
      throw new HttpsError(
        'failed-precondition',
        'This series is not currently published.',
      );
    }

    const firstVid = seriesVideos[0];
    const seriesPrice = firstVid.seriesPriceCents ?? firstVid.priceCents ?? 0;
    if (seriesPrice <= 0) {
      throw new HttpsError(
        'failed-precondition',
        'This series is not currently available for direct purchase.',
      );
    }

    unitAmountCents = Math.round(seriesPrice);
    currency = (firstVid.currency || 'usd').toLowerCase();
    productName = `${firstVid.seriesTitle || firstVid.forVodSeriesTitle || firstVid.title || 'Video Series'} (Full Series)`;
    productDescription =
      firstVid.seriesDescription ||
      firstVid.description ||
      `Full access to all parts in the ${firstVid.seriesTitle || 'series'} series.`;
    thumbnailUrl = firstVid.thumbnailUrl || undefined;
  } else if (videoId) {
    // 1b. Query individual video
    const videoDoc = await db
      .collection(FirestoreCollection.Videos)
      .doc(videoId)
      .get();

    if (!videoDoc.exists) {
      throw new HttpsError('not-found', 'Video not found.');
    }

    const video = firestoreDocToVideoItem(videoDoc);
    if (video.isPublished === false) {
      throw new HttpsError(
        'failed-precondition',
        'This video is not currently published.',
      );
    }

    const isBuyable = Boolean(
      video.isBuyable ||
      (video.priceCents && video.priceCents > 0) ||
      video.accessTier === VodAccessTier.DirectPurchase ||
      (Array.isArray(video.accessTiers) && video.accessTiers.includes(VodAccessTier.DirectPurchase)),
    );

    const price = video.priceCents ?? 0;
    if (!isBuyable || price <= 0) {
      throw new HttpsError(
        'failed-precondition',
        'This video is not currently available for individual purchase.',
      );
    }

    unitAmountCents = Math.round(price);
    currency = (video.currency || 'usd').toLowerCase();
    productName = video.title || 'Video Recording';
    productDescription = video.description || '';
    thumbnailUrl = video.thumbnailUrl || undefined;
  }

  // 2. Resolve Authenticated Member / Stripe Customer
  const stripe = getStripeClient();
  let customerId: string | undefined;
  let memberDocId: string | undefined;
  let memberId: string | undefined;

  const authEmail = request.auth?.token?.email
    ? request.auth.token.email.toLowerCase().trim()
    : undefined;

  if (authEmail) {
    try {
      const member: Member = await getMemberByEmail(authEmail, db);
      memberDocId = member.docId;
      memberId = member.memberId;

      if (member.stripeCustomerId) {
        customerId = member.stripeCustomerId;
      } else {
        const existing = await stripe.customers.list({
          email: authEmail,
          limit: 1,
        });
        if (existing.data.length > 0) {
          customerId = existing.data[0].id;
        } else {
          const created = await stripe.customers.create({
            email: authEmail,
            name: member.name || undefined,
            metadata: {
              memberDocId: member.docId,
              memberId: member.memberId,
            },
          });
          customerId = created.id;
        }
        await db.collection(FirestoreCollection.Members).doc(member.docId).update({
          stripeCustomerId: customerId,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch {
      // Unlinked authenticated email; continue as guest checkout
    }
  }

  // 3. Return URLs
  const fallbackVideoTarget = videoId || '';
  let successUrl = fallbackVideoTarget
    ? `${origin}/videos/${fallbackVideoTarget}?purchase_success=true`
    : `${origin}/order-complete?session_id={CHECKOUT_SESSION_ID}`;

  if (typeof data.successUrl === 'string' && data.successUrl.trim()) {
    try {
      const parsed = new URL(data.successUrl, origin);
      if (allowedOrigins.includes(parsed.origin)) {
        successUrl = data.successUrl;
      }
    } catch {
      // Use fallback
    }
  }

  let cancelUrl = fallbackVideoTarget
    ? `${origin}/videos/${fallbackVideoTarget}`
    : `${origin}/videos`;

  if (typeof data.cancelUrl === 'string' && data.cancelUrl.trim()) {
    try {
      const parsed = new URL(data.cancelUrl, origin);
      if (allowedOrigins.includes(parsed.origin)) {
        cancelUrl = data.cancelUrl;
      }
    } catch {
      // Use fallback
    }
  }

  // 4. Gifting Safeguards & Metadata
  const isGift = Boolean(data.isGift);
  const giftMetadata: Record<string, string> = {};

  if (isGift) {
    const recipientEmail = (data.recipientEmail || '').trim().toLowerCase();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new HttpsError(
        'invalid-argument',
        'A valid recipient email is required when purchasing as a gift.',
      );
    }

    // When email notifications are turned off, gifts can only be sent to existing member accounts
    const mailSettingsSnap = await db.doc('system/mail-settings').get();
    const mailSettings = mailSettingsSnap.exists
      ? (mailSettingsSnap.data() as MailSettings)
      : undefined;
    const mailStatus: MailSendingStatus = resolveNotificationStatus(
      mailSettings,
      TransactionalEmailKey.VodGiftReceived,
    );

    if (mailStatus === MailSendingStatus.Off) {
      let recipientMember: Member | null = null;
      try {
        recipientMember = await getMemberByEmail(recipientEmail, db);
      } catch {
        // Not found
      }
      if (!recipientMember) {
        throw new HttpsError(
          'failed-precondition',
          'Email notifications are currently turned off. Gifts can only be sent to existing member accounts.',
        );
      }
    }

    giftMetadata['isGift'] = 'true';
    giftMetadata['recipientEmail'] = recipientEmail;
    if (data.recipientName?.trim()) {
      giftMetadata['recipientName'] = data.recipientName.trim();
    }
    if (data.giftMessage?.trim()) {
      giftMetadata['giftMessage'] = data.giftMessage.trim().slice(0, 1000);
    }
  }

  // 5. Construct Checkout Session with Dynamic `price_data`
  const metadata: Record<string, string> = {
    orderType: 'vod',
    category: 'vod',
    targetType: isSeries ? 'series' : 'video',
    ...(seriesId ? { seriesId } : {}),
    ...(videoId ? { videoId } : {}),
    ...giftMetadata,
    ...(memberDocId ? { memberDocId } : {}),
    ...(memberId ? { memberId } : {}),
  };

  const lineItem: Stripe.Checkout.SessionCreateParams.LineItem = {
    quantity: 1,
    price_data: {
      currency,
      unit_amount: unitAmountCents,
      product_data: {
        name: productName,
        description: productDescription.slice(0, 500) || undefined,
        images: thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) ? [thumbnailUrl] : undefined,
        metadata: {
          source: 'vod_catalog',
          orderType: 'vod',
          ...(seriesId ? { seriesId } : {}),
          ...(videoId ? { videoId } : {}),
        },
      },
    },
  };

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [lineItem],
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata,
  };

  if (customerId) {
    sessionParams.customer = customerId;
    sessionParams.customer_update = {
      address: 'auto',
      name: 'auto',
    };
  } else if (authEmail) {
    sessionParams.customer_email = authEmail;
  }

  if (memberDocId) {
    sessionParams.client_reference_id = memberDocId;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) {
      throw new HttpsError('internal', 'Stripe did not return a checkout URL.');
    }

    logger.info('Created dynamic VOD Stripe Checkout session', {
      sessionId: session.id,
      seriesId,
      videoId,
      unitAmountCents,
      isGift,
      memberDocId,
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
    };
  } catch (err: any) {
    if (err instanceof HttpsError) throw err;
    logger.error('Failed to create Stripe Checkout session for VOD', {
      error: err.message,
      seriesId,
      videoId,
    });
    throw new HttpsError(
      'internal',
      err.message || 'Could not initiate checkout session.',
    );
  }
});
