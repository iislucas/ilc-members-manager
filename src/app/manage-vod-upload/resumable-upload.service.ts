/* resumable-upload.service.ts
 *
 * Resumable upload engine leveraging Google Cloud Storage Resumable Upload
 * protocol via Firebase Storage SDK. Supports pausing, resuming, chunked streaming,
 * real-time upload speed & ETA tracking, and cross-session persistence via localStorage.
 */

import { Injectable, inject } from '@angular/core';
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  UploadTask,
  UploadTaskSnapshot,
  StorageError,
} from 'firebase/storage';
import * as storageModule from 'firebase/storage';
import { FirebaseStateService } from '../firebase-state.service';

export interface ResumableUploadSession {
  uploadUrl: string;
  storagePath: string;
  uploadItemId: string;
  fileName: string;
  fileSize: number;
  fileLastModified: number;
  createdAt: number;
}

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

export function getUploadSessionKey(file: File): string {
  return `ilc_resumable_upload_${file.name}_${file.size}_${file.lastModified}`;
}

// Runtime dynamic access to internal SDK exports for session URL restoration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const InternalUploadTask: any = (storageModule as Record<string, unknown>)['_UploadTask'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const InternalFbsBlob: any = (storageModule as Record<string, unknown>)['_FbsBlob'];

let activeInitialResumeUrl: string | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BaseUploadTask: any = typeof InternalUploadTask === 'function' ? InternalUploadTask : class {};

class PersistentUploadTask extends BaseUploadTask {
  constructor(reference: unknown, blob: unknown, metadata: unknown, resumeUrl?: string) {
    activeInitialResumeUrl = resumeUrl;
    super(reference, blob, metadata);
    activeInitialResumeUrl = undefined;
  }

  _start(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (activeInitialResumeUrl && !(this as any)._uploadUrl) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any)._uploadUrl = activeInitialResumeUrl;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any)._needToFetchStatus = true;
    }
    if (super._start) {
      super._start();
    }
  }
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
   * Retrieves a saved session from localStorage if available.
   */
  getSavedSession(file: File): ResumableUploadSession | null {
    try {
      const key = getUploadSessionKey(file);
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const session = JSON.parse(raw) as ResumableUploadSession;
      // Validate session age (expire after 7 days)
      if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
        this.clearSession(file);
        return null;
      }
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Saves an active upload session to localStorage.
   */
  saveSession(file: File, session: ResumableUploadSession): void {
    try {
      const key = getUploadSessionKey(file);
      localStorage.setItem(key, JSON.stringify(session));
    } catch (e) {
      console.warn('Could not persist upload session to localStorage:', e);
    }
  }

  /**
   * Clears a saved upload session from localStorage.
   */
  clearSession(file: File): void {
    try {
      const key = getUploadSessionKey(file);
      localStorage.removeItem(key);
    } catch {
      // Ignore localStorage errors
    }
  }

  /**
   * Clears session by storage path or uploadItemId.
   */
  clearSessionByPath(storagePath: string): void {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('ilc_resumable_upload_')) {
          const raw = localStorage.getItem(k);
          if (raw && raw.includes(storagePath)) {
            localStorage.removeItem(k);
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Starts or resumes a chunked video upload.
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

    const savedSession = this.getSavedSession(file);
    const existingUploadUrl =
      savedSession && savedSession.storagePath === storagePath ? savedSession.uploadUrl : undefined;

    const metadata = {
      contentType: file.type || 'video/mp4',
      customMetadata: {
        name: file.name,
        originalSize: String(file.size),
        uploadItemId,
      },
    };

    let task: UploadTask;

    // Use PersistentUploadTask if existing session url is present and constructors are available
    if (existingUploadUrl && typeof InternalUploadTask === 'function' && typeof InternalFbsBlob === 'function') {
      try {
        task = new PersistentUploadTask(
          storageRef,
          new InternalFbsBlob(file),
          metadata,
          existingUploadUrl,
        ) as unknown as UploadTask;
      } catch (err) {
        console.warn('Failed to initialize PersistentUploadTask, starting fresh resumable task:', err);
        this.clearSession(file);
        task = uploadBytesResumable(storageRef, file, metadata);
      }
    } else {
      task = uploadBytesResumable(storageRef, file, metadata);
    }

    let lastBytes = 0;
    let lastTime = Date.now();
    let smoothedSpeed = 0;
    let sessionSaved = Boolean(existingUploadUrl);

    const promise = new Promise<{ downloadUrl: string }>((resolve, reject) => {
      task.on(
        'state_changed',
        (snapshot: UploadTaskSnapshot) => {
          // Once GCS returns the uploadUrl, persist it so it can be resumed
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const currentUploadUrl = (task as any)._uploadUrl;
          if (currentUploadUrl && !sessionSaved) {
            sessionSaved = true;
            this.saveSession(file, {
              uploadUrl: currentUploadUrl,
              storagePath,
              uploadItemId,
              fileName: file.name,
              fileSize: file.size,
              fileLastModified: file.lastModified,
              createdAt: Date.now(),
            });
          }

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

          onProgress({
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: total,
            progressPercent: pct,
            uploadSpeed: formatUploadSpeed(smoothedSpeed),
            eta: formatEta(etaSeconds),
            state: snapshot.state as 'running' | 'paused' | 'success' | 'error',
          });
        },
        (error: StorageError) => {
          // If resuming with a stale/expired upload URL failed, purge the session
          if (existingUploadUrl && error.code === 'storage/unknown') {
            this.clearSession(file);
          }
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
          // Upload complete! Clean up the persisted resumable session
          this.clearSession(file);

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
