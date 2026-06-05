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

/**
 * Computes target canvas dimensions that fit within `maxDim` on the longest
 * side while preserving the source aspect ratio. Never upscales.
 */
function fitWithin(width: number, height: number, maxDim: number): { w: number; h: number } {
  if (width <= 0 || height <= 0) return { w: maxDim, h: maxDim };
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

/** Draws a source (image bitmap or video) onto a fresh canvas and returns a JPEG blob. */
async function drawToJpeg(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxDim: number,
): Promise<Blob> {
  const { w, h } = fitWithin(srcWidth, srcHeight, maxDim);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context for thumbnail.');
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8),
  );
  if (!blob) throw new Error('Failed to encode thumbnail to JPEG.');
  return blob;
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
      const onError = () => reject(new Error('Failed to load video for thumbnail.'));
      video.addEventListener('error', onError, { once: true });
      video.addEventListener(
        'loadeddata',
        () => {
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

// export function deepObjEq(obj1: Object, obj2: Object) {
//   const sortedKeys1 = Object.keys(obj1).sort();
//   const jsonString1 = JSON.stringify(obj1, sortedKeys1);
//   const sortedKeys2 = Object.keys(obj2).sort();
//   const jsonString2 = JSON.stringify(obj2, sortedKeys2);
//   return jsonString1 === jsonString2;
// }
