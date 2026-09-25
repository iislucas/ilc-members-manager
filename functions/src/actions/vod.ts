/* vod.ts
 *
 * Video-on-Demand (VOD) catalog and video grants domain actions
 * for publishing videos, curating series, and provisioning access grants.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { FirestoreCollection, FirestoreSubcollection } from '../data-model/collections';
import {
  VideoItem,
  VideoGrant,
  VideoGrantKind,
  VodAccessTier,
  VodStatus,
  VideoSeries,
  initVideoItem,
  initVideoGrant,
  firestoreDocToVideoItem,
  firestoreDocToVideoGrant,
  groupVideosIntoSeries,
} from '../data-model/vod';
import { getMember, getMemberByEmail } from './members';
import { ActionContext, ActionResult } from './types';

/** Parameters for creating or registering a video catalog item. */
export interface CreateVideoInput {
  videoId?: string;
  title: string;
  description?: string;
  tags?: string[];
  instructorDocId?: string;
  instructorName?: string;
  instructorId?: string;
  eventDocId?: string;
  eventTitle?: string;
  recordedDate?: string;
  location?: string;
  accessTier?: VodAccessTier;
  accessTiers?: VodAccessTier[];
  isBuyable?: boolean;
  priceCents?: number;
  currency?: string;
  stripeProductId?: string;
  stripePriceId?: string;
  seriesId?: string;
  seriesTitle?: string;
  seriesPartIndex?: number;
  isPublished?: boolean;
  featured?: boolean;
  manifestUrl?: string;
  thumbnailUrl?: string;
  trailerUrl?: string;
  trailerVideoId?: string;
  durationSeconds?: number;
}

/** Options for filtering/querying videos. */
export interface VideoListOptions {
  accessTier?: VodAccessTier;
  isPublished?: boolean;
  seriesId?: string;
  featured?: boolean;
  tag?: string;
  searchTerm?: string;
  limitCount?: number;
}

/** Parameters for provisioning video access grants to a member or email. */
export interface GrantVideoAccessInput {
  videoId?: string;
  seriesId?: string;
  recipientMemberDocId?: string;
  recipientEmail?: string;
  grantKind?: VideoGrantKind;
  notes?: string;
  expiresAt?: string;
  orderDocId?: string;
}

/**
 * Retrieves a single video by document ID.
 */
export async function getVideo(
  ctx: ActionContext,
  videoId: string,
): Promise<VideoItem | null> {
  if (!videoId) return null;
  const docRef = ctx.db.collection(FirestoreCollection.Videos).doc(videoId);
  const snap = await docRef.get();
  if (!snap.exists) return null;
  return firestoreDocToVideoItem(snap);
}

/**
 * Lists videos from the catalog matching query criteria.
 */
export async function listVideos(
  ctx: ActionContext,
  options?: VideoListOptions,
): Promise<VideoItem[]> {
  let q = ctx.db.collection(FirestoreCollection.Videos).limit(options?.limitCount || 100);

  if (options?.isPublished !== undefined) {
    q = q.where('isPublished', '==', options.isPublished);
  }
  if (options?.featured !== undefined) {
    q = q.where('featured', '==', options.featured);
  }
  if (options?.seriesId) {
    q = q.where('seriesId', '==', options.seriesId);
  }

  const snap = await q.get();
  let videos = snap.docs.map(firestoreDocToVideoItem);

  if (options?.accessTier) {
    videos = videos.filter(
      (v) => v.accessTier === options.accessTier || v.accessTiers.includes(options.accessTier!),
    );
  }

  if (options?.tag) {
    const cleanTag = options.tag.toLowerCase().trim();
    videos = videos.filter((v) => v.tags && v.tags.includes(cleanTag));
  }

  if (options?.searchTerm) {
    const term = options.searchTerm.toLowerCase().trim();
    videos = videos.filter(
      (v) =>
        v.title.toLowerCase().includes(term) ||
        v.description.toLowerCase().includes(term) ||
        v.instructorName.toLowerCase().includes(term) ||
        (v.seriesTitle && v.seriesTitle.toLowerCase().includes(term)),
    );
  }

  return videos;
}

/** Options for filtering/querying video series collections. */
export interface VideoSeriesListOptions {
  searchTerm?: string;
  limitCount?: number;
}

/**
 * Lists curated video series by querying catalog videos and grouping them.
 */
export async function listVideoSeries(
  ctx: ActionContext,
  options?: VideoSeriesListOptions,
): Promise<VideoSeries[]> {
  const allVideos = await listVideos(ctx, { limitCount: options?.limitCount || 500 });
  const { seriesList } = groupVideosIntoSeries(allVideos);

  if (options?.searchTerm) {
    const term = options.searchTerm.toLowerCase().trim();
    return seriesList.filter(
      (s) =>
        s.seriesId.toLowerCase().includes(term) ||
        s.title.toLowerCase().includes(term) ||
        s.description.toLowerCase().includes(term) ||
        (s.instructorName ? s.instructorName.toLowerCase().includes(term) : false) ||
        s.tags?.some((t) => t.toLowerCase().includes(term)),
    );
  }

  return seriesList;
}

/**
 * Creates a new VideoItem record in /videos.
 */
export async function createVideo(
  ctx: ActionContext,
  input: CreateVideoInput,
): Promise<ActionResult<VideoItem>> {
  if (!input.title?.trim()) {
    return { success: false, error: 'Video title is required.' };
  }

  const nowIso = new Date().toISOString();
  const defaults = initVideoItem();

  const newVideo: VideoItem = {
    ...defaults,
    ...input,
    title: input.title.trim(),
    tags: input.tags || [],
    accessTier: input.accessTier || VodAccessTier.MembersOnly,
    accessTiers: input.accessTiers || (input.accessTier ? [input.accessTier] : [VodAccessTier.MembersOnly]),
    isPublished: Boolean(input.isPublished),
    publishedAt: input.isPublished ? nowIso : '',
    publishedByMemberDocId: input.isPublished ? (ctx.actor?.memberDocId || '') : '',
    createdAt: nowIso,
    lastUpdated: nowIso,
  };

  const colRef = ctx.db.collection(FirestoreCollection.Videos);
  const docRef = input.videoId ? colRef.doc(input.videoId) : colRef.doc();
  newVideo.docId = docRef.id;

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Created video "${newVideo.title}" at /videos/${docRef.id}`);
    return { success: true, data: newVideo, dryRun: true };
  }

  const payload = {
    ...newVideo,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete (payload as { docId?: string }).docId;

  await docRef.set(payload);
  ctx.logger?.(`Created video "${newVideo.title}" with docId: ${docRef.id}`);

  return { success: true, data: newVideo };
}

/**
 * Updates metadata for an existing VideoItem document.
 */
export async function updateVideo(
  ctx: ActionContext,
  videoId: string,
  patch: Partial<VideoItem>,
): Promise<ActionResult<VideoItem>> {
  if (!videoId) {
    return { success: false, error: 'videoId is required.' };
  }

  const existing = await getVideo(ctx, videoId);
  if (!existing) {
    return { success: false, error: `Video "${videoId}" not found.` };
  }

  const updated: VideoItem = {
    ...existing,
    ...patch,
    docId: videoId,
    lastUpdated: new Date().toISOString(),
  };

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Updated video ${videoId}:`, patch);
    return { success: true, data: updated, dryRun: true };
  }

  const docRef = ctx.db.collection(FirestoreCollection.Videos).doc(videoId);
  const payload: Record<string, unknown> = {
    ...patch,
    lastUpdated: FieldValue.serverTimestamp(),
  };
  delete payload['docId'];

  await docRef.set(payload, { merge: true });
  ctx.logger?.(`Updated video "${existing.title}" (${videoId})`);

  return { success: true, data: updated };
}

/**
 * Toggles a video's published status.
 */
export async function setVideoPublished(
  ctx: ActionContext,
  videoId: string,
  isPublished: boolean,
): Promise<ActionResult<VideoItem>> {
  const nowIso = new Date().toISOString();
  return updateVideo(ctx, videoId, {
    isPublished,
    publishedAt: isPublished ? nowIso : '',
    publishedByMemberDocId: isPublished ? (ctx.actor?.memberDocId || '') : '',
  });
}

/**
 * Curates a series of videos, applying title, pricing, and sequence ordering.
 */
export async function createOrUpdateVideoSeries(
  ctx: ActionContext,
  seriesId: string,
  seriesData: Partial<VideoSeries>,
  orderedVideoIds: string[],
): Promise<ActionResult<{ updatedCount: number }>> {
  if (!seriesId?.trim()) {
    return { success: false, error: 'seriesId is required.' };
  }
  if (!orderedVideoIds || orderedVideoIds.length === 0) {
    return { success: false, error: 'At least one videoId is required in the series.' };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Curated series "${seriesId}" across ${orderedVideoIds.length} videos`);
    return { success: true, data: { updatedCount: orderedVideoIds.length }, dryRun: true };
  }

  const batch = ctx.db.batch();

  for (let i = 0; i < orderedVideoIds.length; i++) {
    const vId = orderedVideoIds[i];
    const videoRef = ctx.db.collection(FirestoreCollection.Videos).doc(vId);
    const updates: Record<string, unknown> = {
      seriesId,
      seriesPartIndex: i + 1,
      lastUpdated: FieldValue.serverTimestamp(),
    };

    if (seriesData.title) updates['seriesTitle'] = seriesData.title;
    if (seriesData.description) updates['seriesDescription'] = seriesData.description;
    if (seriesData.priceCents !== undefined) {
      updates['seriesPriceCents'] = seriesData.priceCents;
      updates['priceCents'] = seriesData.priceCents;
      updates['isBuyable'] = seriesData.priceCents > 0;
    }
    if (seriesData.stripeProductId) updates['seriesStripeProductId'] = seriesData.stripeProductId;
    if (seriesData.stripePriceId) {
      updates['seriesStripePriceId'] = seriesData.stripePriceId;
      updates['stripePriceId'] = seriesData.stripePriceId;
    }
    if (seriesData.accessTier) updates['accessTier'] = seriesData.accessTier;
    if (seriesData.accessTiers) updates['accessTiers'] = seriesData.accessTiers;
    if (seriesData.isPublished !== undefined) updates['isPublished'] = seriesData.isPublished;

    batch.set(videoRef, updates, { merge: true });
  }

  await batch.commit();
  ctx.logger?.(`Updated series "${seriesId}" across ${orderedVideoIds.length} videos`);

  return { success: true, data: { updatedCount: orderedVideoIds.length } };
}

/**
 * Provisions video access grant(s) for a member or recipient email.
 * If seriesId is specified, grants access to every video in that series.
 */
export async function grantVideoAccess(
  ctx: ActionContext,
  input: GrantVideoAccessInput,
): Promise<ActionResult<{ grantedCount: number; videoIds: string[] }>> {
  if (!input.videoId && !input.seriesId) {
    return { success: false, error: 'Either videoId or seriesId must be specified.' };
  }

  // Resolve recipient member
  let recipientMember = null;
  if (input.recipientMemberDocId) {
    recipientMember = await getMember(ctx, input.recipientMemberDocId);
  } else if (input.recipientEmail) {
    recipientMember = await getMemberByEmail(ctx, input.recipientEmail);
  }

  if (!recipientMember) {
    return {
      success: false,
      error: `Could not find member matching memberDocId "${input.recipientMemberDocId}" or email "${input.recipientEmail}".`,
    };
  }

  // Find targeted video IDs
  let targetVideoIds: string[] = [];
  if (input.videoId) {
    targetVideoIds = [input.videoId];
  } else if (input.seriesId) {
    const seriesVideos = await listVideos(ctx, { seriesId: input.seriesId, limitCount: 100 });
    targetVideoIds = seriesVideos.map((v) => v.docId);
    if (!targetVideoIds.includes(input.seriesId)) {
      targetVideoIds.push(input.seriesId);
    }
  }

  if (targetVideoIds.length === 0) {
    return { success: false, error: 'No videos found matching the specified target.' };
  }

  const recipientEmail = recipientMember.emails[0] || '';

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Granted ${targetVideoIds.length} video(s)/series to ${recipientMember.name} (${recipientEmail})`);
    return {
      success: true,
      data: { grantedCount: targetVideoIds.length, videoIds: targetVideoIds },
      dryRun: true,
    };
  }

  const batch = ctx.db.batch();
  const nowIso = new Date().toISOString();

  for (const vId of targetVideoIds) {
    const grantPayload: Record<string, unknown> = {
      ...initVideoGrant(vId, recipientMember.docId),
      memberEmail: recipientEmail,
      grantKind: input.grantKind || VideoGrantKind.AdminGrant,
      grantedByMemberDocId: ctx.actor?.memberDocId || '',
      notes: input.notes || '',
      grantedAt: nowIso,
      lastUpdated: FieldValue.serverTimestamp(),
    };
    if (input.orderDocId) grantPayload['orderDocId'] = input.orderDocId;
    if (input.expiresAt) grantPayload['expiresAt'] = input.expiresAt;
    delete grantPayload['docId'];

    // 1. Subcollection: /members/{memberDocId}/videoGrants/{targetId}
    const grantRef = ctx.db
      .collection(FirestoreCollection.Members)
      .doc(recipientMember.docId)
      .collection(FirestoreSubcollection.VideoGrants)
      .doc(vId);
    batch.set(grantRef, grantPayload, { merge: true });

    // 2. Global collection: /video_grants/{memberDocId}_{targetId}
    const globalGrantRef = ctx.db
      .collection(FirestoreCollection.VideoGrants)
      .doc(`${recipientMember.docId}_${vId}`);
    batch.set(globalGrantRef, grantPayload, { merge: true });
  }

  await batch.commit();
  ctx.logger?.(`Provisioned ${targetVideoIds.length} video grants for ${recipientMember.name} (${recipientMember.docId})`);

  return {
    success: true,
    data: { grantedCount: targetVideoIds.length, videoIds: targetVideoIds },
  };
}

/**
 * Revokes a video grant from a member.
 */
export async function revokeVideoAccess(
  ctx: ActionContext,
  memberDocId: string,
  videoId: string,
): Promise<ActionResult<void>> {
  if (!memberDocId || !videoId) {
    return { success: false, error: 'memberDocId and videoId are required.' };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Revoked video grant ${videoId} from member ${memberDocId}`);
    return { success: true, dryRun: true };
  }

  const grantRef = ctx.db
    .collection(FirestoreCollection.Members)
    .doc(memberDocId)
    .collection(FirestoreSubcollection.VideoGrants)
    .doc(videoId);
  await grantRef.delete();

  const globalGrantRef = ctx.db
    .collection(FirestoreCollection.VideoGrants)
    .doc(`${memberDocId}_${videoId}`);
  await globalGrantRef.delete();

  ctx.logger?.(`Revoked video grant ${videoId} from member ${memberDocId}`);

  return { success: true };
}

/**
 * Lists all active video grants held by a member.
 */
export async function listMemberVideoGrants(
  ctx: ActionContext,
  memberDocId: string,
): Promise<VideoGrant[]> {
  if (!memberDocId) return [];
  const colRef = ctx.db
    .collection(FirestoreCollection.Members)
    .doc(memberDocId)
    .collection(FirestoreSubcollection.VideoGrants);

  const snap = await colRef.get();
  return snap.docs.map(firestoreDocToVideoGrant);
}

/**
 * Deletes a video document from /videos.
 */
export async function deleteVideo(
  ctx: ActionContext,
  videoId: string,
): Promise<ActionResult<void>> {
  const video = await getVideo(ctx, videoId);
  if (!video) {
    return { success: false, error: `Video "${videoId}" not found.` };
  }

  if (ctx.dryRun) {
    ctx.logger?.(`[DRY-RUN] Deleted video ${videoId} ("${video.title}")`);
    return { success: true, dryRun: true };
  }

  await ctx.db.collection(FirestoreCollection.Videos).doc(videoId).delete();
  ctx.logger?.(`Deleted video "${video.title}" (${videoId})`);

  return { success: true };
}
