import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ImageLoaderService {
  private cachePrefix = 'img_cache_';

  async loadImage(url: string): Promise<string> {
    const cached = await this.getCachedBlobUrl(url);
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load image: ${response.statusText}`);
      }
      const blob = await response.blob();
      this.saveToCache(url, blob);
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Error loading image:', error);
      throw error;
    }
  }

  async getCachedBlobUrl(url: string): Promise<string | null> {
    const key = this.getCacheKey(url);
    const cachedBase64 = localStorage.getItem(key);
    if (cachedBase64) {
      try {
        const res = await fetch(cachedBase64);
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      } catch (e) {
        console.warn('Failed to recover image from cache', e);
        localStorage.removeItem(key);
      }
    }
    return null;
  }

  private getCacheKey(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = (hash << 5) - hash + url.charCodeAt(i);
      hash |= 0;
    }
    return this.cachePrefix + hash;
  }

  private async saveToCache(url: string, blob: Blob) {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result as string;
      try {
        localStorage.setItem(this.getCacheKey(url), base64data);
      } catch (e) {
        console.warn('Failed to cache image (likely quota exceeded)', e);
      }
    };
    reader.readAsDataURL(blob);
  }
}
