/* idb-storage.service.ts
 *
 * Lightweight, asynchronous IndexedDB storage service for client-side caching.
 *
 * Used to persist large collections (members, schools, instructors, events)
 * across application restarts without blocking the main UI thread (unlike localStorage).
 * Includes an in-memory fallback for environments where IndexedDB is unavailable
 * (e.g. non-browser test environments or restricted web workers).
 */

import { Injectable } from '@angular/core';

const DB_NAME = 'ilc_members_manager_cache';
const DB_VERSION = 1;
const STORE_NAME = 'collection_cache';

@Injectable({
  providedIn: 'root',
})
export class IdbStorageService {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private memoryFallback = new Map<string, unknown>();

  private getDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    if (typeof window === 'undefined' || !window.indexedDB) {
      this.dbPromise = Promise.resolve(null);
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = (event) => {
          console.warn('IndexedDB failed to open, using in-memory cache fallback:', event);
          resolve(null);
        };
      } catch (err) {
        console.warn('Error initializing IndexedDB, using in-memory cache fallback:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.getDb();
    if (!db) {
      return this.memoryFallback.get(key) as T | undefined;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          resolve(request.result as T | undefined);
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        console.warn(`IdbStorageService: read error for key "${key}", falling back to memory:`, err);
        resolve(this.memoryFallback.get(key) as T | undefined);
      }
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.memoryFallback.set(key, value);
    const db = await this.getDb();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(value, key);

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        console.warn(`IdbStorageService: write error for key "${key}":`, err);
        resolve();
      }
    });
  }

  async delete(key: string): Promise<void> {
    this.memoryFallback.delete(key);
    const db = await this.getDb();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        console.warn(`IdbStorageService: delete error for key "${key}":`, err);
        resolve();
      }
    });
  }

  async clear(): Promise<void> {
    this.memoryFallback.clear();
    const db = await this.getDb();
    if (!db) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          resolve();
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        console.warn('IdbStorageService: clear error:', err);
        resolve();
      }
    });
  }

  async keys(): Promise<string[]> {
    const db = await this.getDb();
    if (!db) {
      return Array.from(this.memoryFallback.keys());
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAllKeys();

        request.onsuccess = () => {
          const keys = (request.result || []).map((k) => String(k));
          resolve(keys);
        };

        request.onerror = () => {
          reject(request.error);
        };
      } catch (err) {
        console.warn('IdbStorageService: keys error, falling back to memory:', err);
        resolve(Array.from(this.memoryFallback.keys()));
      }
    });
  }
}
