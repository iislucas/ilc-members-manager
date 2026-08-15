/* vod-offline-storage.service.ts
 *
 * Angular Injectable service managing on-device local video storage,
 * offline pre-caching, storage usage estimation, and cache clearing.
 */

import { Injectable, signal } from '@angular/core';
import { VideoItem } from '../../functions/src/data-model';

export interface OfflineDownloadProgress {
  videoId: string;
  percent: number;
  currentChunk: number;
  totalChunks: number;
  bytesDownloaded: number;
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export interface OfflineVideoEntry {
  videoId: string;
  bytes: number;
  chunkCount: number;
  savedAt: string;
}

export const VOD_CACHE_NAME = 'ilc-vod-segment-cache-v1';

@Injectable({
  providedIn: 'root',
})
export class VodOfflineStorageService {
  // Total local storage usage
  totalStorageBytes = signal<number>(0);
  totalCachedChunks = signal<number>(0);

  // Map of active offline download progress per videoId
  downloadProgressMap = signal<Record<string, OfflineDownloadProgress>>({});

  // Map of completed offline videos per videoId
  offlineVideosMap = signal<Record<string, OfflineVideoEntry>>({});

  private activeAbortControllers = new Map<string, AbortController>();

  constructor() {
    if (typeof window !== 'undefined' && 'caches' in window) {
      this.refreshStorageUsage();
    }
  }

  /**
   * Refreshes total local storage used across all cached video segments.
   */
  async refreshStorageUsage(): Promise<{ bytes: number; count: number }> {
    if (typeof window === 'undefined' || !('caches' in window)) {
      return { bytes: 0, count: 0 };
    }

    try {
      const cache = await caches.open(VOD_CACHE_NAME);
      const requests = await cache.keys();
      let totalBytes = 0;
      const count = requests.length;

      const videoMap: Record<string, { bytes: number; count: number; savedAt: string }> = {};

      for (const req of requests) {
        const url = req.url;
        let vidId = '';
        const match = url.match(/\/vod\/([^/?#]+)\//) || url.match(/[?&]videoId=([^&#]+)/);
        if (match && match[1]) {
          vidId = match[1];
        }

        const res = await cache.match(req);
        if (res) {
          const blob = await res.blob();
          const size = blob.size || 0;
          totalBytes += size;

          if (vidId) {
            if (!videoMap[vidId]) {
              videoMap[vidId] = { bytes: 0, count: 0, savedAt: new Date().toISOString() };
            }
            videoMap[vidId].bytes += size;
            videoMap[vidId].count += 1;
          }
        }
      }

      this.totalStorageBytes.set(totalBytes);
      this.totalCachedChunks.set(count);

      const entries: Record<string, OfflineVideoEntry> = {};
      for (const [vid, data] of Object.entries(videoMap)) {
        if (data.count > 0) {
          entries[vid] = {
            videoId: vid,
            bytes: data.bytes,
            chunkCount: data.count,
            savedAt: data.savedAt,
          };
        }
      }
      this.offlineVideosMap.set(entries);

      return { bytes: totalBytes, count };
    } catch {
      return { bytes: 0, count: 0 };
    }
  }

  /**
   * Checks if a video has any segments cached on device.
   */
  isVideoSavedOffline(videoId: string): boolean {
    if (!videoId) return false;
    const entry = this.offlineVideosMap()[videoId];
    return Boolean(entry && entry.chunkCount > 0);
  }

  /**
   * Gets the downloaded size for a specific video in bytes.
   */
  getVideoOfflineSize(videoId: string): number {
    return this.offlineVideosMap()[videoId]?.bytes || 0;
  }

  /**
   * Gets active download progress for a video.
   */
  getProgress(videoId: string): OfflineDownloadProgress | undefined {
    return this.downloadProgressMap()[videoId];
  }

  /**
   * Downloads all segments of a video into local CacheStorage for offline playback.
   */
  async makeVideoAvailableOffline(
    video: VideoItem,
    manifestUrl?: string,
  ): Promise<void> {
    if (typeof window === 'undefined' || !('caches' in window)) {
      throw new Error('Local CacheStorage is not supported in this browser.');
    }

    const videoId = video.docId;
    const url = manifestUrl || video.manifestUrl;
    if (!url) {
      throw new Error('No streaming URL available to cache offline.');
    }

    const abortController = new AbortController();
    this.activeAbortControllers.set(videoId, abortController);

    this.updateProgress(videoId, {
      videoId,
      percent: 0,
      currentChunk: 0,
      totalChunks: 0,
      bytesDownloaded: 0,
      status: 'downloading',
    });

    try {
      const cache = await caches.open(VOD_CACHE_NAME);

      // 1. If direct MP4 video
      if (!url.includes('.m3u8')) {
        const res = await fetch(url, { signal: abortController.signal });
        const buf = await res.arrayBuffer();
        const responseToCache = new Response(buf, {
          headers: {
            'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=31536000',
          },
        });
        await cache.put(url, responseToCache);
        this.updateProgress(videoId, {
          videoId,
          percent: 100,
          currentChunk: 1,
          totalChunks: 1,
          bytesDownloaded: buf.byteLength,
          status: 'completed',
        });
        await this.refreshStorageUsage();
        return;
      }

      // 2. Fetch Master Playlist
      const masterRes = await fetch(url, { signal: abortController.signal });
      const masterText = await masterRes.text();
      await cache.put(
        url,
        new Response(masterText, {
          headers: {
            'Content-Type': 'application/x-mpegURL',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      );

      // Parse sub-playlists
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      const lines = masterText.split('\n').map((l) => l.trim());
      const subPlaylists: string[] = [];

      for (const line of lines) {
        if (line && !line.startsWith('#') && line.endsWith('.m3u8')) {
          subPlaylists.push(line.startsWith('http') ? line : baseUrl + line);
        }
      }

      // Choose preferred rendition
      const targetPlaylistUrl = subPlaylists.length > 0 ? subPlaylists[0] : url;
      let chunkUrls: string[] = [];

      if (subPlaylists.length > 0) {
        const subRes = await fetch(targetPlaylistUrl, { signal: abortController.signal });
        const subText = await subRes.text();
        await cache.put(
          targetPlaylistUrl,
          new Response(subText, {
            headers: {
              'Content-Type': 'application/x-mpegURL',
              'Cache-Control': 'public, max-age=3600',
            },
          }),
        );
        const subBaseUrl = targetPlaylistUrl.substring(0, targetPlaylistUrl.lastIndexOf('/') + 1);
        const subLines = subText.split('\n').map((l) => l.trim());
        for (const line of subLines) {
          if (line && !line.startsWith('#') && (line.endsWith('.ts') || line.endsWith('.m4s') || line.endsWith('.mp4'))) {
            chunkUrls.push(line.startsWith('http') ? line : subBaseUrl + line);
          }
        }
      } else {
        for (const line of lines) {
          if (line && !line.startsWith('#') && (line.endsWith('.ts') || line.endsWith('.m4s') || line.endsWith('.mp4'))) {
            chunkUrls.push(line.startsWith('http') ? line : baseUrl + line);
          }
        }
      }

      if (chunkUrls.length === 0) {
        throw new Error('No media chunks found in stream playlist.');
      }

      const totalChunks = chunkUrls.length;
      let alreadyCachedCount = 0;
      let accumulatedBytes = 0;
      const unCachedChunkIndices: number[] = [];

      for (let i = 0; i < chunkUrls.length; i++) {
        const chunkUrl = chunkUrls[i];
        const existing = await cache.match(chunkUrl);
        if (existing) {
          alreadyCachedCount++;
          const b = await existing.blob();
          accumulatedBytes += b.size;
        } else {
          unCachedChunkIndices.push(i);
        }
      }

      if (unCachedChunkIndices.length === 0) {
        this.updateProgress(videoId, {
          videoId,
          percent: 100,
          currentChunk: totalChunks,
          totalChunks,
          bytesDownloaded: accumulatedBytes,
          status: 'completed',
        });
        await this.refreshStorageUsage();
        return;
      }

      this.updateProgress(videoId, {
        videoId,
        percent: Math.round((alreadyCachedCount / totalChunks) * 100),
        currentChunk: alreadyCachedCount,
        totalChunks,
        bytesDownloaded: accumulatedBytes,
        status: 'downloading',
      });

      for (let step = 0; step < unCachedChunkIndices.length; step++) {
        if (abortController.signal.aborted) {
          throw new Error('Download cancelled by user.');
        }

        const idx = unCachedChunkIndices[step];
        const chunkUrl = chunkUrls[idx];
        const chunkRes = await fetch(chunkUrl, { signal: abortController.signal });
        if (!chunkRes.ok) {
          throw new Error(`Failed to download video chunk (${chunkRes.status})`);
        }
        const chunkBuf = await chunkRes.arrayBuffer();
        accumulatedBytes += chunkBuf.byteLength;

        try {
          await cache.put(
            chunkUrl,
            new Response(chunkBuf, {
              headers: {
                'Content-Type': 'video/MP2T',
                'Cache-Control': 'public, max-age=31536000',
              },
            }),
          );
        } catch (putErr: any) {
          if (
            putErr.name === 'QuotaExceededError' ||
            putErr.message?.toLowerCase().includes('quota') ||
            putErr.message?.toLowerCase().includes('space')
          ) {
            throw new Error(
              'Device storage quota exceeded. Please free up disk space or click "Clear Cache".',
            );
          }
          throw putErr;
        }

        const currentDone = alreadyCachedCount + step + 1;
        const pct = Math.round((currentDone / totalChunks) * 100);
        this.updateProgress(videoId, {
          videoId,
          percent: pct,
          currentChunk: currentDone,
          totalChunks,
          bytesDownloaded: accumulatedBytes,
          status: 'downloading',
        });
      }

      this.updateProgress(videoId, {
        videoId,
        percent: 100,
        currentChunk: totalChunks,
        totalChunks,
        bytesDownloaded: accumulatedBytes,
        status: 'completed',
      });

      await this.refreshStorageUsage();
    } catch (err: any) {
      const isAbort = abortController.signal.aborted;
      let errMsg = err.message || 'Offline download failed.';
      if (
        err.name === 'QuotaExceededError' ||
        err.message?.toLowerCase().includes('quota') ||
        err.message?.toLowerCase().includes('space')
      ) {
        errMsg =
          'Device storage quota exceeded. Please free up disk space or click "Clear Cache".';
      }
      this.updateProgress(videoId, {
        videoId,
        percent: 0,
        currentChunk: 0,
        totalChunks: 0,
        bytesDownloaded: 0,
        status: isAbort ? 'cancelled' : 'failed',
        error: isAbort ? undefined : errMsg,
      });
      if (!isAbort) {
        throw err;
      }
    } finally {
      this.activeAbortControllers.delete(videoId);
    }
  }

  /**
   * Cancels an active offline download.
   */
  cancelOfflineDownload(videoId: string): void {
    const controller = this.activeAbortControllers.get(videoId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(videoId);
    }
    this.updateProgress(videoId, {
      videoId,
      percent: 0,
      currentChunk: 0,
      totalChunks: 0,
      bytesDownloaded: 0,
      status: 'cancelled',
    });
  }

  /**
   * Deletes all cached chunks for a specific video.
   */
  async removeVideoFromOffline(videoId: string): Promise<void> {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    try {
      const cache = await caches.open(VOD_CACHE_NAME);
      const requests = await cache.keys();

      for (const req of requests) {
        if (req.url.includes(`/vod/${videoId}/`) || req.url.includes(`videoId=${videoId}`)) {
          await cache.delete(req);
        }
      }

      const progress = { ...this.downloadProgressMap() };
      delete progress[videoId];
      this.downloadProgressMap.set(progress);

      await this.refreshStorageUsage();
    } catch {
      // Ignore deletion errors
    }
  }

  /**
   * Clears all cached video chunks across the entire application.
   */
  async clearAllCache(): Promise<void> {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    try {
      await caches.delete(VOD_CACHE_NAME);
      this.totalStorageBytes.set(0);
      this.totalCachedChunks.set(0);
      this.downloadProgressMap.set({});
      this.offlineVideosMap.set({});
    } catch {
      // Ignore cache wipe errors
    }
  }

  formatBytes(bytes: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  private updateProgress(videoId: string, progress: OfflineDownloadProgress): void {
    const current = { ...this.downloadProgressMap() };
    current[videoId] = progress;
    this.downloadProgressMap.set(current);
  }
}
