import { FsTimestamp, GenericFsDoc, normalizeLastUpdated } from './base';

// ==================================================================
// # Video on Demand (VOD) Models
// ==================================================================

/** Access tiers determining who can stream the video. */
export enum VodAccessTier {
  Public = 'public',
  MembersOnly = 'members_only',
  InstructorsOnly = 'instructors_only',
  ClassVideoSubscribers = 'class_video_subscribers',
  DirectPurchase = 'direct_purchase',
  AdminOnly = 'admin_only',
}

/** Processing state of the video transcoding job. */
export enum VodStatus {
  None = 'none',
  Queued = 'queued',
  Transcoding = 'transcoding',
  Ready = 'ready',
  Failed = 'failed',
}

/** Source origin of an individual video access grant. */
export enum VideoGrantKind {
  StripePurchase = 'stripe_purchase',
  AdminGrant = 'admin_grant',
  EventAttendance = 'event_attendance',
  Complimentary = 'complimentary',
}

export type VideoItem = {
  docId: string; // Matches videoId / source uploadDocId
  sourceUploadDocId: string; // Original UploadItem docId in /members/{id}/uploads/
  sourceMemberDocId: string; // Member docId who uploaded the original video

  // Public Catalog & Search Metadata
  title: string; // Curated video title
  description: string; // Markdown or plain text description
  tags: string[]; // Searchable tags (e.g. ['spinning_hands', 'level_3', 'paris_2026'])

  // Instructor & Event Credits
  instructorDocId: string; // Featured instructor memberDocId
  instructorName: string; // Display name snapshot (e.g. "Sam Chin [INST-001]")
  instructorId: string; // Cached instructor ID (e.g. "1")
  eventDocId: string; // Linked IlcEvent docId (or '' if standalone)
  eventTitle: string; // Cached event title
  recordedDate: string; // YYYY-MM-DD
  location: string; // Venue / City

  // Access & Pricing Configuration
  accessTier: VodAccessTier; // Primary access tier (for backward compatibility)
  accessTiers: VodAccessTier[]; // Multiple allowed access tiers (e.g. [InstructorsOnly, ClassVideoSubscribers])
  isBuyable: boolean; // Whether one-off purchase is available
  isTrailer: boolean; // Whether this item is a standalone trailer/preview
  trailerVideoId: string; // Linked trailer VideoItem docId (e.g. 'vimeo_1189216257' or '')
  minLevel?: number; // Optional minimum student level requirement (e.g. Level 3+)
  priceCents?: number; // Direct purchase price in cents (e.g. 1500 for $15.00)
  currency?: string; // e.g. 'usd'
  stripeProductId?: string; // Stripe prod_... ID if purchasable
  stripePriceId?: string; // Stripe price_... ID if purchasable

  // Video Series / Collection Configuration
  seriesId?: string; // Identifier / slug of the parent series (e.g. 'understanding-spacing')
  seriesTitle?: string; // Curated title of the video series
  seriesDescription?: string; // Overview / description of the series
  seriesPartIndex?: number; // Part number / sequence index within the series (1, 2, 3...)
  seriesPriceCents?: number; // Direct purchase price in cents for the whole series (e.g. 4999 for $49.99)
  seriesStripeProductId?: string; // Stripe prod_... ID for purchasing the series
  seriesStripePriceId?: string; // Stripe price_... ID for purchasing the series

  // Publishing & Curation Flags
  isPublished: boolean; // Visible in public catalog
  featured: boolean; // Displayed in top hero banner
  publishedAt: string; // ISO Timestamp
  publishedByMemberDocId: string; // Admin who approved/published the video

  // Technical & Transcoding Data
  vodStatus: VodStatus; // Enum transcoding status
  vodJobId?: string; // GCP Transcoder Job ID
  vodError?: string; // Transcoding error log if failed
  forVodPageId?: string; // Optional linked VOD series page ID
  forVodSeriesTitle?: string; // Optional linked VOD series title
  vimeoSourceId?: string; // Original Vimeo video ID if imported
  vimeoLink?: string; // Original Vimeo URL if imported

  // Media Endpoints
  manifestUrl: string; // HLS master manifest (protected/CDN URL)
  thumbnailUrl: string; // Public CDN URL for poster image
  trailerUrl?: string; // Optional short preview trailer URL
  spriteSheetUrl?: string; // Scrubber preview sprite sheet (e.g. "spritesheet.jpg")
  spriteIntervalSeconds: number; // e.g. 5
  spriteWidth: number; // 160 px
  spriteHeight: number; // 90 px

  // Video Metrics
  durationSeconds: number; // Total video length in seconds
  resolutions: string[]; // e.g. ['360p', '480p', '720p', '1080p']
  originalSize: number; // Raw upload size in bytes
  chapters?: { title: string; startSeconds: number }[]; // Optional video chapters / timestamps

  createdAt: string; // ISO Date
  lastUpdated: string; // ISO Date
};

/** Grouped collection of videos in a series with aggregated metrics and series-level pricing. */
export type VideoSeries = {
  seriesId: string;
  title: string;
  description: string;
  priceCents?: number;
  currency?: string;
  stripeProductId?: string;
  stripePriceId?: string;
  accessTier?: VodAccessTier;
  accessTiers?: VodAccessTier[];
  isPublished?: boolean;
  featured?: boolean;
  thumbnailUrl?: string;
  trailerVideoId?: string;
  instructorName?: string;
  instructorDocId?: string;
  instructorId?: string;
  eventDocId?: string;
  eventTitle?: string;
  recordedDate?: string;
  location?: string;
  tags: string[];
  videoCount: number;
  totalDurationSeconds: number;
  videos: VideoItem[]; // Ordered by seriesPartIndex ascending
};

/**
 * Extracts a robust series grouping identifier and series title for any video item.
 * Supports explicit seriesId, legacy forVodPageId, explicit seriesTitle, and heuristic
 * multi-part title patterns (e.g. "Title : Part 1", "Title - Part 1", "Title Part 1", "Title 1 of 2").
 */
export function getVideoSeriesGroupingKey(video: VideoItem): {
  key: string;
  isExplicitSeries: boolean;
  seriesTitle: string;
  partIndex?: number;
} {
  if (video.seriesId && video.seriesId.trim().length > 0) {
    return {
      key: `series_id:${video.seriesId.trim()}`,
      isExplicitSeries: true,
      seriesTitle: video.seriesTitle?.trim() || video.title,
      partIndex: video.seriesPartIndex,
    };
  }

  if (video.forVodPageId && video.forVodPageId.trim().length > 0) {
    return {
      key: `vod_page_id:${video.forVodPageId.trim()}`,
      isExplicitSeries: true,
      seriesTitle: video.forVodSeriesTitle?.trim() || video.seriesTitle?.trim() || video.title,
      partIndex: video.seriesPartIndex,
    };
  }

  if (video.seriesTitle && video.seriesTitle.trim().length > 0) {
    return {
      key: `series_title:${video.seriesTitle.trim().toLowerCase()}`,
      isExplicitSeries: true,
      seriesTitle: video.seriesTitle.trim(),
      partIndex: video.seriesPartIndex,
    };
  }

  // Heuristic pattern extraction from title
  const rawTitle = (video.title || '').trim();
  const partMatch = rawTitle.match(/^(.*?)\s*[:\-–]?\s*(?:(?:part|vol\.?|volume|episode|ep\.?)\s*(\d+|[ivx]+)|\b(\d+)\s+of\s+(\d+))\s*$/i);
  if (partMatch && partMatch[1] && partMatch[1].trim().length >= 2) {
    const baseTitle = partMatch[1].trim();
    let detectedPart: number | undefined = undefined;
    if (partMatch[2]) {
      const parsed = parseInt(partMatch[2], 10);
      if (!isNaN(parsed)) detectedPart = parsed;
      else {
        const romanMap: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
        detectedPart = romanMap[partMatch[2].toLowerCase()];
      }
    } else if (partMatch[3]) {
      detectedPart = parseInt(partMatch[3], 10);
    }

    return {
      key: `base_title:${baseTitle.toLowerCase()}`,
      isExplicitSeries: false,
      seriesTitle: baseTitle,
      partIndex: typeof video.seriesPartIndex === 'number' ? video.seriesPartIndex : detectedPart,
    };
  }

  return {
    key: '',
    isExplicitSeries: false,
    seriesTitle: rawTitle,
    partIndex: video.seriesPartIndex,
  };
}

/**
 * Groups an array of VideoItems into VideoSeries collections and standalone single videos.
 */
export function groupVideosIntoSeries(allVideos: VideoItem[]): {
  seriesList: VideoSeries[];
  standaloneVideos: VideoItem[];
} {
  const trailers = new Map<string, VideoItem>();
  for (const v of allVideos) {
    if (v.isTrailer) {
      trailers.set(v.docId, v);
    }
  }

  const groups = new Map<
    string,
    {
      key: string;
      isExplicitSeries: boolean;
      seriesTitle: string;
      videos: VideoItem[];
    }
  >();

  const standaloneVideos: VideoItem[] = [];

  for (const v of allVideos) {
    if (v.isTrailer) continue;

    const info = getVideoSeriesGroupingKey(v);
    if (!info.key) {
      standaloneVideos.push(v);
      continue;
    }

    const group = groups.get(info.key) || {
      key: info.key,
      isExplicitSeries: info.isExplicitSeries,
      seriesTitle: info.seriesTitle,
      videos: [],
    };
    group.videos.push(v);
    if (info.isExplicitSeries) {
      group.isExplicitSeries = true;
    }
    groups.set(info.key, group);
  }

  const seriesList: VideoSeries[] = [];

  for (const [, group] of groups) {
    // If not explicit series and only 1 video matched base title pattern, leave as standalone
    if (!group.isExplicitSeries && group.videos.length <= 1) {
      standaloneVideos.push(...group.videos);
      continue;
    }

    const sortedVids = [...group.videos].sort((a, b) => {
      const aInfo = getVideoSeriesGroupingKey(a);
      const bInfo = getVideoSeriesGroupingKey(b);
      const aPart = typeof aInfo.partIndex === 'number' ? aInfo.partIndex : 9999;
      const bPart = typeof bInfo.partIndex === 'number' ? bInfo.partIndex : 9999;
      if (aPart !== bPart) return aPart - bPart;
      return a.title.localeCompare(b.title);
    });

    const firstVid = sortedVids[0];
    const totalDuration = sortedVids.reduce((sum, v) => sum + (v.durationSeconds || 0), 0);
    const seriesId =
      sortedVids.find((v) => v.seriesId)?.seriesId ||
      sortedVids.find((v) => v.forVodPageId)?.forVodPageId ||
      group.key.replace(/^[a-z_]+:/, '');

    const title =
      sortedVids.find((v) => v.seriesTitle)?.seriesTitle ||
      sortedVids.find((v) => v.forVodSeriesTitle)?.forVodSeriesTitle ||
      group.seriesTitle ||
      firstVid?.title ||
      'Series';

    const desc =
      sortedVids.find((v) => v.seriesDescription)?.seriesDescription ||
      firstVid?.description ||
      '';

    const priceCents =
      sortedVids.find((v) => typeof v.seriesPriceCents === 'number')?.seriesPriceCents ??
      sortedVids.find((v) => typeof v.priceCents === 'number')?.priceCents;

    const stripePriceId =
      sortedVids.find((v) => v.seriesStripePriceId)?.seriesStripePriceId ||
      sortedVids.find((v) => v.stripePriceId)?.stripePriceId;

    const stripeProductId =
      sortedVids.find((v) => v.seriesStripeProductId)?.seriesStripeProductId ||
      sortedVids.find((v) => v.stripeProductId)?.stripeProductId;

    const trailerVidId = sortedVids.find((v) => v.trailerVideoId)?.trailerVideoId || '';
    const thumb =
      sortedVids.find((v) => v.thumbnailUrl)?.thumbnailUrl ||
      (trailerVidId && trailers.get(trailerVidId)?.thumbnailUrl) ||
      '';

    const instructor = sortedVids.find((v) => v.instructorName);
    const allTags = Array.from(new Set(sortedVids.flatMap((v) => v.tags || [])));
    const allAccessTiers = Array.from(
      new Set(
        sortedVids.flatMap((v) =>
          Array.isArray(v.accessTiers) && v.accessTiers.length > 0
            ? v.accessTiers
            : (v.accessTier ? [v.accessTier] : [VodAccessTier.MembersOnly]),
        ),
      ),
    );

    seriesList.push({
      seriesId,
      title,
      description: desc,
      priceCents,
      currency: firstVid?.currency || 'usd',
      stripeProductId,
      stripePriceId,
      accessTier: allAccessTiers[0] || VodAccessTier.MembersOnly,
      accessTiers: allAccessTiers,
      isPublished: sortedVids.some((v) => v.isPublished),
      featured: sortedVids.some((v) => v.featured),
      thumbnailUrl: thumb,
      trailerVideoId: trailerVidId,
      instructorName: instructor?.instructorName || '',
      instructorDocId: instructor?.instructorDocId || '',
      instructorId: instructor?.instructorId || '',
      eventDocId: sortedVids.find((v) => v.eventDocId)?.eventDocId || '',
      eventTitle: sortedVids.find((v) => v.eventTitle)?.eventTitle || '',
      recordedDate: firstVid?.recordedDate || '',
      location: firstVid?.location || '',
      tags: allTags,
      videoCount: sortedVids.length,
      totalDurationSeconds: totalDuration,
      videos: sortedVids,
    });
  }

  return { seriesList, standaloneVideos };
}

export function initVideoItem(): VideoItem {
  return {
    docId: '',
    sourceUploadDocId: '',
    sourceMemberDocId: '',
    title: '',
    description: '',
    tags: [],
    instructorDocId: '',
    instructorName: '',
    instructorId: '',
    eventDocId: '',
    eventTitle: '',
    recordedDate: '',
    location: '',
    accessTier: VodAccessTier.MembersOnly,
    accessTiers: [VodAccessTier.MembersOnly],
    isBuyable: false,
    isTrailer: false,
    trailerVideoId: '',
    seriesId: '',
    seriesTitle: '',
    seriesDescription: '',
    seriesStripeProductId: '',
    seriesStripePriceId: '',
    isPublished: false,
    featured: false,
    publishedAt: '',
    publishedByMemberDocId: '',
    vodStatus: VodStatus.None,
    manifestUrl: '',
    thumbnailUrl: '',
    spriteIntervalSeconds: 5,
    spriteWidth: 160,
    spriteHeight: 90,
    durationSeconds: 0,
    resolutions: [],
    originalSize: 0,
    createdAt: '',
    lastUpdated: '',
  };
}

export type VideoItemFsDoc = Omit<VideoItem, 'docId'> & {
  lastUpdated: FsTimestamp;
};

export function firestoreDocToVideoItem(doc: GenericFsDoc): VideoItem {
  const data = (doc.data() || {}) as Partial<VideoItemFsDoc>;
  const createdAt = data.createdAt || new Date().toISOString();
  const lastUpdated = normalizeLastUpdated(data.lastUpdated) || createdAt;
  const rawAccessTiers = Array.isArray(data.accessTiers) && data.accessTiers.length > 0
    ? data.accessTiers
    : (data.accessTier ? [data.accessTier] : [VodAccessTier.MembersOnly]);
  const isBuyable = Boolean(
    data.isBuyable ||
    rawAccessTiers.includes(VodAccessTier.DirectPurchase) ||
    (data.priceCents && data.priceCents > 0) ||
    (data.seriesPriceCents && data.seriesPriceCents > 0),
  );
  const seriesId = data.seriesId || data.forVodPageId || '';
  const seriesTitle = data.seriesTitle || data.forVodSeriesTitle || '';
  return {
    ...initVideoItem(),
    ...data,
    docId: doc.id,
    tags: Array.isArray(data.tags) ? data.tags : [],
    resolutions: Array.isArray(data.resolutions) ? data.resolutions : [],
    accessTier: data.accessTier || rawAccessTiers[0] || VodAccessTier.MembersOnly,
    accessTiers: rawAccessTiers,
    isBuyable,
    isTrailer: Boolean(data.isTrailer),
    trailerVideoId: data.trailerVideoId || '',
    seriesId,
    seriesTitle,
    seriesDescription: data.seriesDescription || '',
    seriesPartIndex: typeof data.seriesPartIndex === 'number' ? data.seriesPartIndex : undefined,
    seriesPriceCents: typeof data.seriesPriceCents === 'number' ? data.seriesPriceCents : undefined,
    seriesStripeProductId: data.seriesStripeProductId || '',
    seriesStripePriceId: data.seriesStripePriceId || '',
    forVodPageId: data.forVodPageId || seriesId,
    forVodSeriesTitle: data.forVodSeriesTitle || seriesTitle,
    vimeoSourceId: data.vimeoSourceId || '',
    vimeoLink: data.vimeoLink || '',
    vodStatus: data.vodStatus || VodStatus.None,
    createdAt,
    lastUpdated,
  };
}

export type VideoGrant = {
  docId: string; // Matches videoId
  videoId: string; // Matches VideoItem docId
  memberDocId: string; // Member document ID
  memberEmail: string; // Email snapshot
  grantKind: VideoGrantKind; // Enum: StripePurchase, AdminGrant, etc.
  orderDocId?: string; // Reference to /orders/{orderDocId}
  stripeSessionId?: string; // Stripe checkout session ID
  amountPaidCents?: number; // In cents
  grantedByMemberDocId?: string; // Admin docId if granted manually
  notes?: string; // Reason / reference notes
  grantedAt: string; // ISO Timestamp
  expiresAt?: string; // Optional expiration timestamp (for rentals or temporary access)
};

export type VideoGrantFsDoc = Omit<VideoGrant, 'docId'>;

export function initVideoGrant(videoId = '', memberDocId = ''): VideoGrant {
  return {
    docId: videoId,
    videoId,
    memberDocId,
    memberEmail: '',
    grantKind: VideoGrantKind.StripePurchase,
    grantedAt: new Date().toISOString(),
  };
}

export function firestoreDocToVideoGrant(doc: GenericFsDoc): VideoGrant {
  const data = (doc.data() || {}) as Partial<VideoGrantFsDoc>;
  return {
    ...initVideoGrant(doc.id, data.memberDocId || ''),
    ...data,
    docId: doc.id,
    grantKind: data.grantKind || VideoGrantKind.StripePurchase,
    grantedAt: data.grantedAt || new Date().toISOString(),
  };
}

export type VideoProgress = {
  docId: string; // Matches videoId
  videoId: string; // Matches VideoItem docId
  memberDocId: string;
  lastPositionSeconds: number; // e.g. 420.5
  durationSeconds: number; // Total video length
  completed: boolean; // true if >= 90% watched
  completedAt?: string; // ISO Timestamp
  lastWatchedAt: string; // ISO Timestamp
};

export type VideoProgressFsDoc = Omit<VideoProgress, 'docId'>;

export function initVideoProgress(videoId = '', memberDocId = ''): VideoProgress {
  return {
    docId: videoId,
    videoId,
    memberDocId,
    lastPositionSeconds: 0,
    durationSeconds: 0,
    completed: false,
    lastWatchedAt: new Date().toISOString(),
  };
}

export function firestoreDocToVideoProgress(doc: GenericFsDoc): VideoProgress {
  const data = (doc.data() || {}) as Partial<VideoProgressFsDoc>;
  return {
    ...initVideoProgress(doc.id, data.memberDocId || ''),
    ...data,
    docId: doc.id,
    lastWatchedAt: data.lastWatchedAt || new Date().toISOString(),
  };
}

export type VideoTagMeta = {
  tag: string; // Short identifier / slug (e.g. "spinning_hands", "level_3")
  label?: string; // Human-readable title (e.g. "Spinning Hands")
  description: string; // Explanatory summary displayed on hover tooltip
  category?: string; // Optional group for future organization
  createdAt?: string; // ISO timestamp
  lastUpdated?: string; // ISO timestamp
};

export function initVideoTagMeta(tag = '', description = '', label = ''): VideoTagMeta {
  return {
    tag,
    label: label || tag,
    description,
    createdAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

export type SystemVideoTagsDoc = {
  tags: Record<string, VideoTagMeta>;
  lastUpdated: string;
};

export type SystemTagsDoc = SystemVideoTagsDoc;

export type TagItem = {
  tag: string;
  label?: string;
  description?: string;
};

export function initSystemVideoTagsDoc(): SystemVideoTagsDoc {
  return {
    tags: {},
    lastUpdated: '',
  };
}

export const initSystemTagsDoc = initSystemVideoTagsDoc;
