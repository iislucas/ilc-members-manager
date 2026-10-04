import deepObjEq from 'fast-deep-equal';

/**
 * Converts a Date object to a string in 'YYYY-MM-DD' format.
 * @param date The date to convert.
 * @returns The formatted date string, or an empty string if the date is null or invalid.
 */
export function dateToString(date: Date | null | undefined): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts a string in 'YYYY-MM-DD' format to a Date object.
 * @param dateString The string to convert.
 * @returns The Date object, or null if the string is empty or invalid.
 */
export function stringToDate(dateString: string | null | undefined): Date {
  if (!dateString || typeof dateString !== 'string') {
    return new Date();
  }
  const parts = dateString.split('-');
  if (parts.length !== 3) {
    return new Date();
  }
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {
    return new Date();
  }
  return date;
}

/**
 * Converts a restricted subset of HTML to Markdown.
 * Specifically handles tags found in Google Calendar events.
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return '';

  let md = html;

  // Normalize characters and entities first
  md = md.replace(/’/g, "'");
  md = md.replace(/–/g, "-");
  md = md.replace(/\u00a0/g, ' ');
  md = md.replace(/&amp;/gi, '&');

  // Strip <span> tags (with or without attributes), keeping inner content.
  md = md.replace(/<span[^>]*>/gi, '');
  md = md.replace(/<\/span>/gi, '');

  // Remove empty styling tags (handles nested tags like <b><u></u></b>)
  let oldMd;
  do {
    oldMd = md;
    md = md.replace(/<(b|strong|i|em|u|p)>\s*<\/\1>/gi, '');
  } while (md !== oldMd);



  // Merge consecutive tags of the same type
  do {
    oldMd = md;
    md = md.replace(/<\/b><b>/gi, '');
    md = md.replace(/<\/strong><strong>/gi, '');
    md = md.replace(/<\/i><i>/gi, '');
    md = md.replace(/<\/em><em>/gi, '');
  } while (md !== oldMd);

  // Handle specific pattern <strong>Title<br></strong> -> **Title** 
  md = md.replace(/<strong>(.*?)<br\s*\/?>\s*<\/strong>/gi, '**$1** ');

  // Replace headings
  md = md.replace(/<h4>/gi, '#### ');
  md = md.replace(/<\/h4>/gi, '\n\n');

  // Replace paragraphs
  md = md.replace(/<p>/gi, '');
  md = md.replace(/<\/p>/gi, '\n\n');

  // Replace strong
  md = md.replace(/<strong>/gi, '**');
  md = md.replace(/<\/strong>/gi, '**');

  // Replace br
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Replace links
  md = md.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // Replace underline (remove)
  md = md.replace(/<u>/gi, '');
  md = md.replace(/<\/u>/gi, '');

  // Replace emphasis/italic
  md = md.replace(/<em>/gi, '_');
  md = md.replace(/<\/em>/gi, '_');
  md = md.replace(/<i>/gi, '_');
  md = md.replace(/<\/i>/gi, '_');

  // Replace bold
  md = md.replace(/<b>/gi, '**');
  md = md.replace(/<\/b>/gi, '**');

  // Clean up multiple newlines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

/**
 * Checks if a string looks like HTML.
 */
export function looksLikeHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

export { deepObjEq };
export * from './object-diff';

/**
 * Computes target canvas dimensions that fit within `maxDim` on the longest
 * side while preserving the source aspect ratio. Never upscales.
 */
export function fitWithin(width: number, height: number, maxDim: number): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: maxDim, h: Math.round((maxDim * 9) / 16) };
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** Returns human-readable aspect ratio text (e.g. "16:9", "4:3", "9:16", "1:1"). */
export function getAspectRatioLabel(width: number, height: number): string {
  if (!width || !height) return '';
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(ratio - 4 / 3) < 0.05) return '4:3';
  if (Math.abs(ratio - 1) < 0.05) return '1:1';
  if (Math.abs(ratio - 9 / 16) < 0.05) return '9:16';
  if (Math.abs(ratio - 21 / 9) < 0.05) return '21:9';
  return `${ratio.toFixed(2)}:1`;
}

/** Draws a source (image bitmap or video) onto a fresh canvas and returns a JPEG blob. */
async function drawToJpeg(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxDim: number,
  quality = 0.85,
): Promise<Blob> {
  const { w, h } = fitWithin(srcWidth, srcHeight, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context for thumbnail.');
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Failed to encode thumbnail to JPEG.');
  return blob;
}

/**
 * Captures the current visible frame of an HTMLVideoElement and returns a scaled JPEG Blob
 * preserving the video's native aspect ratio.
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  maxDim = 1280,
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  const nativeWidth = video.videoWidth;
  const nativeHeight = video.videoHeight;
  if (!nativeWidth || !nativeHeight) {
    throw new Error('Video frame dimensions are not available (videoWidth or videoHeight is 0).');
  }
  const { w, h } = fitWithin(nativeWidth, nativeHeight, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context for thumbnail.');
  ctx.drawImage(video, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Failed to encode video frame to JPEG.');
  return { blob, width: w, height: h };
}

/**
 * Generates an aspect-preserving JPEG thumbnail from an image File or Blob.
 */
export async function createThumbnailFromImage(
  fileOrBlob: Blob | File,
  maxDim = 1280,
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  let width = 0;
  let height = 0;
  let source: CanvasImageSource;
  let closeFn: (() => void) | undefined;

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(fileOrBlob);
    width = bitmap.width;
    height = bitmap.height;
    source = bitmap;
    closeFn = () => bitmap.close();
  } else {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image for thumbnail.'));
      img.src = url;
    });
    width = img.naturalWidth;
    height = img.naturalHeight;
    source = img;
    closeFn = () => URL.revokeObjectURL(url);
  }

  try {
    const { w, h } = fitWithin(width, height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context for thumbnail.');
    ctx.drawImage(source, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
    );
    if (!blob) throw new Error('Failed to encode thumbnail to JPEG.');
    return { blob, width: w, height: h };
  } finally {
    closeFn?.();
  }
}

/**
 * Generates a downscaled JPEG thumbnail (aspect-preserving, fit within `maxDim`)
 * from an image file. Throws if the file cannot be decoded.
 */
export async function makeImageThumbnail(file: File, maxDim = 320): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    return await drawToJpeg(bitmap, bitmap.width, bitmap.height, maxDim);
  } finally {
    bitmap.close();
  }
}

/**
 * Generates a downscaled JPEG thumbnail from an early frame of a video file.
 * Loads the video off-screen, seeks a little past the start, and captures the
 * frame. Throws if the browser cannot decode the video.
 */
export async function makeVideoThumbnail(file: File, maxDim = 320): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Video thumbnail extraction timed out.'));
      }, 5000);
      const onError = () => {
        clearTimeout(timeoutId);
        reject(new Error('Failed to load video for thumbnail.'));
      };
      video.addEventListener('error', onError, { once: true });
      video.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timeoutId);
          const target = Number.isFinite(video.duration)
            ? Math.min(1, video.duration / 2)
            : 0;
          video.addEventListener('seeked', () => resolve(), { once: true });
          // Seeking can be a no-op if we're already there; nudge then fall back.
          try {
            video.currentTime = target;
          } catch {
            resolve();
          }
        },
        { once: true },
      );
    });
    return await drawToJpeg(video, video.videoWidth, video.videoHeight, maxDim);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Generates a JPEG preview thumbnail for an image or video file, dispatching by
 * MIME type. Rejects for unsupported types or on decode failure so callers can
 * fall back to an icon.
 */
export async function makeThumbnail(file: File, maxDim = 320): Promise<Blob> {
  if (file.type.startsWith('image/')) return makeImageThumbnail(file, maxDim);
  if (file.type.startsWith('video/')) return makeVideoThumbnail(file, maxDim);
  throw new Error(`No preview generator for file type "${file.type}".`);
}

/**
 * Result returned by generateVideoSpriteSheet.
 */
export interface VideoSpriteSheetResult {
  spriteBlob: Blob;
  posterBlob?: Blob;
  frameCount: number;
  columnCount: number;
  rowCount: number;
  frameWidth: number;
  frameHeight: number;
  intervalSeconds: number;
  durationSeconds: number;
}

export interface VideoSpriteSheetOptions {
  intervals?: number; // Total number of frames, default 25
  columns?: number; // Columns in grid, default 5
  frameWidth?: number; // Width of each frame in px, default 160
  frameHeight?: number; // Height of each frame in px, default 90
  includePoster?: boolean; // Whether to extract a poster thumbnail, default true
  posterWidth?: number; // Width of poster thumbnail in px, default 640
  posterHeight?: number; // Height of poster thumbnail in px, default 360
  quality?: number; // JPEG quality (0 to 1), default 0.8
}

/**
 * Generates a composite sprite sheet of video thumbnail frames sampled at evenly
 * distributed intervals across the video duration.
 *
 * Defaults to a 5x5 grid (25 frames, 160x90 per frame = 800x450 px composite image),
 * which provides ~4% scrub bar resolution while generating in ~1s in browser canvas.
 */
export async function generateVideoSpriteSheet(
  fileOrUrl: File | string,
  options: VideoSpriteSheetOptions = {},
): Promise<VideoSpriteSheetResult> {
  const intervals = options.intervals ?? 25;
  const columns = options.columns ?? 5;
  const frameWidth = options.frameWidth ?? 160;
  const frameHeight = options.frameHeight ?? 90;
  const rows = Math.ceil(intervals / columns);
  const totalFrames = intervals;
  const quality = options.quality ?? 0.8;

  const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new Error('Failed to load video metadata for sprite sheet.'));
      video.addEventListener('error', onError, { once: true });
      if (video.readyState >= 1) {
        resolve();
      } else {
        video.addEventListener('loadedmetadata', () => resolve(), { once: true });
      }
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Video duration is invalid or non-finite.');
    }

    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = columns * frameWidth;
    spriteCanvas.height = rows * frameHeight;
    const ctx = spriteCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2D canvas context for sprite sheet.');
    }

    let posterBlob: Blob | undefined;
    const posterCanvas = options.includePoster !== false ? document.createElement('canvas') : null;
    if (posterCanvas) {
      posterCanvas.width = options.posterWidth ?? 640;
      posterCanvas.height = options.posterHeight ?? 360;
    }

    // Helper to seek and wait for seeked event with a safety timeout
    const seekTo = (targetSec: number): Promise<void> => {
      return new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onSeeked = () => {
          if (timer) clearTimeout(timer);
          resolve();
        };
        timer = setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }, 1500);
        video.addEventListener('seeked', onSeeked, { once: true });
        try {
          video.currentTime = targetSec;
        } catch {
          if (timer) clearTimeout(timer);
          resolve();
        }
      });
    };

    // Capture frames across intervals
    const intervalSeconds = duration / totalFrames;
    for (let i = 0; i < totalFrames; i++) {
      const targetTime = Math.min(
        Math.max(0, (i + 0.5) * intervalSeconds),
        Math.max(0, duration - 0.1),
      );
      await seekTo(targetTime);

      const col = i % columns;
      const row = Math.floor(i / columns);
      ctx.drawImage(video, col * frameWidth, row * frameHeight, frameWidth, frameHeight);

      // Grab poster around ~5% into video or on first frame
      if (posterCanvas && !posterBlob && (i === 0 || targetTime >= duration * 0.05)) {
        const pCtx = posterCanvas.getContext('2d');
        if (pCtx) {
          pCtx.drawImage(video, 0, 0, posterCanvas.width, posterCanvas.height);
          posterBlob = (await new Promise<Blob | null>((res) =>
            posterCanvas.toBlob(res, 'image/jpeg', 0.85),
          )) || undefined;
        }
      }
    }

    if (posterCanvas && !posterBlob) {
      const pCtx = posterCanvas.getContext('2d');
      if (pCtx) {
        pCtx.drawImage(video, 0, 0, posterCanvas.width, posterCanvas.height);
        posterBlob = (await new Promise<Blob | null>((res) =>
          posterCanvas.toBlob(res, 'image/jpeg', 0.85),
        )) || undefined;
      }
    }

    const spriteBlob = await new Promise<Blob | null>((resolve) =>
      spriteCanvas.toBlob(resolve, 'image/jpeg', quality),
    );

    if (!spriteBlob) {
      throw new Error('Failed to encode sprite sheet canvas to JPEG.');
    }

    return {
      spriteBlob,
      posterBlob,
      frameCount: totalFrames,
      columnCount: columns,
      rowCount: rows,
      frameWidth,
      frameHeight,
      intervalSeconds,
      durationSeconds: Math.round(duration),
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    if (typeof fileOrUrl !== 'string') {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Rewrites relative HLS stream playlist and fragment URLs when hosted in Firebase Storage.
 *
 * In Firebase Storage, files are hosted at:
 * `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<url-encoded-path>?alt=media&token=<token>`
 * Standard RFC-compliant URL resolution strips the encoded folder path when resolving relative
 * child playlists (e.g. `hd.m3u8`) and fragment files (e.g. `segment_000.ts`), resolving them against `/o/`
 * and dropping query parameters. This function restores the folder path, `alt=media`, and `token`.
 */
export function fixFirebaseHlsUrl(
  requestUrl: string,
  rootManifestUrl: string | null | undefined,
): string {
  if (!rootManifestUrl || !rootManifestUrl.includes('firebasestorage.googleapis.com')) {
    return requestUrl;
  }
  let rootParsed: URL;
  let reqParsed: URL;
  try {
    rootParsed = new URL(rootManifestUrl);
    reqParsed = new URL(requestUrl, rootManifestUrl);
  } catch {
    return requestUrl;
  }

  // Root storage path is /v0/b/<bucket>/o/<encoded-path>
  const rootMatch = rootParsed.pathname.match(/^(\/v0\/b\/[^/]+\/o\/)(.+)$/);
  if (!rootMatch) return reqParsed.toString();

  const prefix = rootMatch[1]; // e.g. "/v0/b/bucket/o/"
  const rootDecodedPath = decodeURIComponent(rootMatch[2]);
  const lastSlash = rootDecodedPath.lastIndexOf('/');
  if (lastSlash === -1) return reqParsed.toString();
  const folder = rootDecodedPath.substring(0, lastSlash + 1);

  if (reqParsed.pathname.startsWith(prefix)) {
    const rawReqPath = reqParsed.pathname.slice(prefix.length);
    const decodedReqPath = decodeURIComponent(rawReqPath);
    if (!decodedReqPath.startsWith(folder)) {
      const fixedPath = folder + decodedReqPath;
      reqParsed.pathname = prefix + encodeURIComponent(fixedPath);
      if (!reqParsed.searchParams.has('alt') && rootParsed.searchParams.has('alt')) {
        reqParsed.searchParams.set('alt', rootParsed.searchParams.get('alt')!);
      }
      if (!reqParsed.searchParams.has('token') && rootParsed.searchParams.has('token')) {
        reqParsed.searchParams.set('token', rootParsed.searchParams.get('token')!);
      }
      return reqParsed.toString();
    }
  }
  return reqParsed.toString();
}

/**
 * Extracts a specific frame from a sprite sheet image at a given timestamp.
 */
export async function captureSpriteFrame(
  spriteSheetUrl: string,
  targetSeconds: number,
  intervalSeconds: number,
  frameWidth: number,
  frameHeight: number,
  columnCount: number,
  rowCount: number,
  maxDim = 1280,
  quality = 0.9,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load sprite sheet image.'));
    img.src = spriteSheetUrl;
  });

  const interval = intervalSeconds > 0 ? intervalSeconds : 5;
  const cols = columnCount > 0 ? columnCount : 5;
  const rows = rowCount > 0 ? rowCount : 5;
  const frameIndex = Math.max(0, Math.floor(targetSeconds / interval));
  const col = frameIndex % cols;
  const row = Math.floor(frameIndex / cols) % rows;
  const sx = col * frameWidth;
  const sy = row * frameHeight;

  const { w, h } = fitWithin(frameWidth, frameHeight, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context for sprite frame extraction.');

  ctx.drawImage(img, sx, sy, frameWidth, frameHeight, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality),
  );
  if (!blob) throw new Error('Failed to encode sprite frame to JPEG.');
  return { blob, width: w, height: h };
}

