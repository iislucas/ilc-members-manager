/* resumable-upload.service.ts
 *
 * Resumable upload engine leveraging Firebase Cloud Storage SDK.
 * Supports pausing, resuming, real-time upload speed & ETA tracking,
 * UI-thread-friendly throttled progress updates, and extended retry limits.
 */

import { Injectable, inject } from '@angular/core';
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  UploadMetadata,
  UploadTask,
  UploadTaskSnapshot,
  StorageError,
} from 'firebase/storage';
import { FirebaseStateService } from '../firebase-state.service';

export interface UploadProgressUpdate {
  bytesTransferred: number;
  totalBytes: number;
  progressPercent: number;
  uploadSpeed: string;
  eta: string;
  state: 'running' | 'paused' | 'success' | 'error';
}

export function formatUploadSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0 || !isFinite(bytesPerSecond)) return '';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(Math.floor(Math.log(bytesPerSecond) / Math.log(k)), sizes.length - 1);
  const val = parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(1));
  return `${val} ${sizes[i]}`;
}

export function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '';
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s > 0 ? s + 's ' : ''}left`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM > 0 ? remM + 'm ' : ''}left`;
}

@Injectable({
  providedIn: 'root',
})
export class ResumableUploadService {
  private firebaseState = inject(FirebaseStateService);

  /**
   * Configures the Firebase Storage instance with an extended retry limit (24 hours)
   * so large multi-gigabyte uploads (8GB+) do not abort after the 10-minute default.
   */
  getStorageInstance() {
    const storage = getStorage(this.firebaseState.app);
    // Set 24 hour retry timeout (default is 10 minutes = 600,000 ms)
    storage.maxUploadRetryTime = 24 * 60 * 60 * 1000;
    return storage;
  }

  /**
   * Backward-compatibility helper for clearing any upload session state.
   */
  clearSession(_file?: File): void {
    // No-op in standard uploadBytesResumable mode
  }

  /**
   * Starts a resumable video upload via the official Firebase Storage SDK.
   *
   * @param file The video file to upload
   * @param storagePath Target path in Cloud Storage
   * @param uploadItemId Unique ID for this upload entry
   * @param onProgress Callback invoked with live byte progress, percentage, speed, and ETA
   * @returns Object with the active `UploadTask` and a `promise` resolving with `{ downloadUrl }`
   */
  uploadVideo(
    file: File,
    storagePath: string,
    uploadItemId: string,
    onProgress: (update: UploadProgressUpdate) => void,
  ): { task: UploadTask; promise: Promise<{ downloadUrl: string }> } {
    const storage = this.getStorageInstance();
    const storageRef = ref(storage, storagePath);

    const metadata: UploadMetadata = {
      contentType: file.type || 'video/mp4',
      customMetadata: {
        name: file.name,
        originalSize: String(file.size),
        uploadItemId,
      },
    };

    const task = uploadBytesResumable(storageRef, file, metadata);

    let lastBytes = 0;
    let lastTime = Date.now();
    let smoothedSpeed = 0;
    let lastEmitTime = 0;
    let lastReportedState = '';

    const promise = new Promise<{ downloadUrl: string }>((resolve, reject) => {
      task.on(
        'state_changed',
        (snapshot: UploadTaskSnapshot) => {
          const now = Date.now();
          const timeElapsed = (now - lastTime) / 1000;

          if (timeElapsed >= 0.5) {
            const bytesDelta = Math.max(0, snapshot.bytesTransferred - lastBytes);
            const currentSpeed = bytesDelta / timeElapsed;
            smoothedSpeed = smoothedSpeed === 0 ? currentSpeed : smoothedSpeed * 0.7 + currentSpeed * 0.3;
            lastBytes = snapshot.bytesTransferred;
            lastTime = now;
          }

          const total = snapshot.totalBytes || file.size;
          const pct = total > 0 ? Math.min(100, Math.round((snapshot.bytesTransferred / total) * 100)) : 0;
          const remainingBytes = Math.max(0, total - snapshot.bytesTransferred);
          const etaSeconds = smoothedSpeed > 0 ? remainingBytes / smoothedSpeed : 0;
          const state = snapshot.state as 'running' | 'paused' | 'success' | 'error';

          // Throttle progress events to at most once per 200ms to eliminate UI thread thrashing
          const shouldEmit =
            state !== lastReportedState ||
            pct === 100 ||
            now - lastEmitTime >= 200;

          if (shouldEmit) {
            lastEmitTime = now;
            lastReportedState = state;
            onProgress({
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: total,
              progressPercent: pct,
              uploadSpeed: formatUploadSpeed(smoothedSpeed),
              eta: formatEta(etaSeconds),
              state,
            });
          }
        },
        (error: StorageError) => {
          onProgress({
            bytesTransferred: lastBytes,
            totalBytes: file.size,
            progressPercent: 0,
            uploadSpeed: '',
            eta: '',
            state: 'error',
          });
          reject(error);
        },
        async () => {
          try {
            const downloadUrl = await getDownloadURL(storageRef);
            onProgress({
              bytesTransferred: file.size,
              totalBytes: file.size,
              progressPercent: 100,
              uploadSpeed: '',
              eta: '',
              state: 'success',
            });
            resolve({ downloadUrl });
          } catch (urlErr) {
            reject(urlErr);
          }
        },
      );
    });

    return { task, promise };
  }
}
