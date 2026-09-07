import { GenericFsDoc } from './base';
import { VodStatus } from './vod';

// ==================================================================
// # Uploads / Materials
// ==================================================================
// Firestore path: /members/{memberDocId}/uploads/{uploadDocId}
// Stored per-member for private instructor uploads and event materials.

export enum UploadItemSource {
  Direct = 'direct',
  Event = 'event',
}

export type UploadItem = {
  docId: string; // Firestore doc ID (auto-generated)
  memberDocId: string; // Member who uploaded the file
  memberId: string; // Cached human-readable member ID (e.g. 'US402')
  memberName: string; // Cached member display name
  instructorId: string; // Cached instructor ID (if applicable, e.g. '1')

  name: string; // Display / file name
  contentType: string; // MIME type (e.g., 'video/mp4', 'image/jpeg')
  size: number; // File size in bytes
  url: string; // Storage download URL (original file)
  previewUrl: string; // Storage download URL (JPEG preview thumbnail)
  storagePath: string; // Cloud storage path of original
  previewStoragePath: string; // Cloud storage path of preview thumbnail

  // Organizing principles
  date: string; // YYYY-MM-DD (media / recording date)
  location: string; // Free-text location / city / venue
  eventDocId: string; // Linked IlcEvent docId (or '' if none)
  eventTitle: string; // Cached event title for display & search
  notes: string; // Description / notes
  tags: string[]; // Searchable tags
  source: UploadItemSource; // 'direct' (materials page) vs 'event' (event edit page)

  // VOD Curation & Transcoding Status
  vodStatus?: VodStatus; // 'none' | 'queued' | 'transcoding' | 'ready' | 'failed'
  vodVideoId?: string; // Linked document ID in /videos (e.g. uploadDocId)
  vodJobId?: string; // GCP Transcoder job resource name / ID for tracking
  vodPublishedAt?: string; // ISO date string when published

  createdAt: string; // ISO date string
  lastUpdated: string; // ISO date string
};

export function initUploadItem(): UploadItem {
  return {
    docId: '',
    memberDocId: '',
    memberId: '',
    memberName: '',
    instructorId: '',
    name: '',
    contentType: '',
    size: 0,
    url: '',
    previewUrl: '',
    storagePath: '',
    previewStoragePath: '',
    date: '',
    location: '',
    eventDocId: '',
    eventTitle: '',
    notes: '',
    tags: [],
    source: UploadItemSource.Direct,
    vodStatus: VodStatus.None,
    vodVideoId: '',
    vodJobId: '',
    vodPublishedAt: '',
    createdAt: '',
    lastUpdated: '',
  };
}

export type UploadItemFsDoc = Omit<UploadItem, 'docId'>;

export function firestoreDocToUploadItem(doc: GenericFsDoc): UploadItem {
  const data = (doc.data() || {}) as Partial<UploadItemFsDoc>;
  const createdAt = data.createdAt || new Date().toISOString();
  const lastUpdated = data.lastUpdated || createdAt;
  return {
    ...initUploadItem(),
    ...data,
    docId: doc.id,
    tags: Array.isArray(data.tags) ? data.tags : [],
    vodStatus: data.vodStatus || VodStatus.None,
    vodVideoId: data.vodVideoId || '',
    vodJobId: data.vodJobId || '',
    vodPublishedAt: data.vodPublishedAt || '',
    createdAt,
    lastUpdated,
  };
}
