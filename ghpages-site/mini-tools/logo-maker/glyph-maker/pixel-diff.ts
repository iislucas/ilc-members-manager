/* Reference character image loader, synchronous Path2D alpha rasterizer,
 * and signed Red/Cyan pixel-diff renderer for 200x200 character SVGs.
 */

import { STROKE_PALETTE } from './defaults.js';
import { sampleCatmullRom3D } from './stroke-svg.js';
import {
  CharacterModel,
  DiffMetrics,
  GlyphId,
  VIEWBOX_SIZE,
  getEl,
} from './types.js';

const PIXEL_COUNT = VIEWBOX_SIZE * VIEWBOX_SIZE;

const refAlphaByGlyph = new Map<GlyphId, Uint8ClampedArray>();

// Shared offscreen 200x200 canvas for synchronous Path2D coverage rasterization.
let rasterCanvas: HTMLCanvasElement | null = null;
let rasterCtx: CanvasRenderingContext2D | null = null;

function getRasterContext(): CanvasRenderingContext2D {
  if (!rasterCanvas || !rasterCtx) {
    rasterCanvas = document.createElement('canvas');
    rasterCanvas.width = VIEWBOX_SIZE;
    rasterCanvas.height = VIEWBOX_SIZE;
    const ctx = rasterCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('2D canvas context unavailable');
    }
    rasterCtx = ctx;
  }
  return rasterCtx;
}

function extractAlphaGridFromImage(img: HTMLImageElement): Uint8ClampedArray {
  const tmp = document.createElement('canvas');
  tmp.width = VIEWBOX_SIZE;
  tmp.height = VIEWBOX_SIZE;
  const ctx = tmp.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return new Uint8ClampedArray(PIXEL_COUNT);
  }
  ctx.clearRect(0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE);
  ctx.drawImage(img, 0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE);
  const rgba = ctx.getImageData(0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE).data;

  let minA = 255;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < minA) minA = rgba[i];
  }

  const out = new Uint8ClampedArray(PIXEL_COUNT);
  if (minA < 245) {
    // Image already encodes glyph coverage in its alpha channel.
    for (let p = 0; p < PIXEL_COUNT; p++) {
      out[p] = rgba[p * 4 + 3];
    }
    return out;
  }

  // Opaque image fallback: infer foreground ink polarity from the 4 corners.
  const cornerIndices = [
    0,
    (VIEWBOX_SIZE - 1) * 4,
    (VIEWBOX_SIZE - 1) * VIEWBOX_SIZE * 4,
    (PIXEL_COUNT - 1) * 4,
  ];
  let cornerLum = 0;
  for (const idx of cornerIndices) {
    cornerLum += 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
  }
  cornerLum /= cornerIndices.length;
  const darkBackground = cornerLum < 128;

  for (let p = 0; p < PIXEL_COUNT; p++) {
    const idx = p * 4;
    const lum = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
    const ink = darkBackground ? lum : 255 - lum;
    out[p] = Math.max(0, Math.min(255, Math.round(ink)));
  }
  return out;
}

export function loadGlyphReferenceAsset(
  glyphId: GlyphId,
  assetUrl: string,
): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const alpha = extractAlphaGridFromImage(img);
      refAlphaByGlyph.set(glyphId, alpha);
      resolve(alpha);
    };
    img.onerror = () => {
      reject(new Error(`Failed to load reference image: ${assetUrl}`));
    };
    img.src = assetUrl;
  });
}

export function setCustomGlyphReference(
  glyphId: GlyphId,
  img: HTMLImageElement,
): Uint8ClampedArray {
  const alpha = extractAlphaGridFromImage(img);
  refAlphaByGlyph.set(glyphId, alpha);
  return alpha;
}

export function getGlyphReferenceAlpha(
  glyphId: GlyphId,
): Uint8ClampedArray | null {
  return refAlphaByGlyph.get(glyphId) ?? null;
}

export function rasterizePathsAlpha(paths: readonly string[]): Uint8ClampedArray {
  const ctx = getRasterContext();
  ctx.clearRect(0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < paths.length; i++) {
    const d = paths[i];
    if (!d) continue;
    ctx.fill(new Path2D(d));
  }
  const rgba = ctx.getImageData(0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE).data;
  const out = new Uint8ClampedArray(PIXEL_COUNT);
  for (let p = 0; p < PIXEL_COUNT; p++) {
    out[p] = rgba[p * 4 + 3];
  }
  return out;
}

export function rasterizePath2DObjectsAlpha(
  pathObjs: readonly (Path2D | null)[],
): Uint8ClampedArray {
  const ctx = getRasterContext();
  ctx.clearRect(0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < pathObjs.length; i++) {
    const p2d = pathObjs[i];
    if (p2d) {
      ctx.fill(p2d);
    }
  }
  const rgba = ctx.getImageData(0, 0, VIEWBOX_SIZE, VIEWBOX_SIZE).data;
  const out = new Uint8ClampedArray(PIXEL_COUNT);
  for (let p = 0; p < PIXEL_COUNT; p++) {
    out[p] = rgba[p * 4 + 3];
  }
  return out;
}

function drawAlphaAsInk(
  canvas: HTMLCanvasElement,
  alpha: Uint8ClampedArray,
): CanvasRenderingContext2D | null {
  canvas.width = VIEWBOX_SIZE;
  canvas.height = VIEWBOX_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const imgData = ctx.createImageData(VIEWBOX_SIZE, VIEWBOX_SIZE);
  const d = imgData.data;
  // Dark slate backdrop (#0f172a = 15, 23, 42) blended with crisp ivory ink (#f8fafc = 248, 250, 252).
  for (let p = 0; p < PIXEL_COUNT; p++) {
    const t = alpha[p] / 255;
    const idx = p * 4;
    d[idx] = Math.round(15 + t * (248 - 15));
    d[idx + 1] = Math.round(23 + t * (250 - 23));
    d[idx + 2] = Math.round(42 + t * (252 - 42));
    d[idx + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return ctx;
}

// Updates Reference, Generated, and Signed Red/Cyan Diff canvases and returns accuracy metrics.
export function updateComparisonPanels(
  model: CharacterModel,
  paths: readonly string[],
  overlayAnchorsOnGen: boolean,
): DiffMetrics | null {
  const refCanvas = getEl<HTMLCanvasElement>('ref-canvas');
  const genCanvas = getEl<HTMLCanvasElement>('gen-canvas');
  const diffCanvas = getEl<HTMLCanvasElement>('diff-canvas');

  const genAlpha = rasterizePathsAlpha(paths);
  const genCtx = drawAlphaAsInk(genCanvas, genAlpha);

  if (overlayAnchorsOnGen && genCtx) {
    for (let s = 0; s < model.strokes.length; s++) {
      const color = STROKE_PALETTE[s % STROKE_PALETTE.length];
      const stroke = model.strokes[s];
      const sampled = sampleCatmullRom3D(
        stroke.points,
        model.radiusScale,
        model.offsetX,
        model.offsetY,
        2.0,
      );
      if (sampled.length >= 2) {
        genCtx.beginPath();
        genCtx.moveTo(sampled[0].x, sampled[0].y);
        for (let k = 1; k < sampled.length; k++) {
          genCtx.lineTo(sampled[k].x, sampled[k].y);
        }
        genCtx.strokeStyle = color;
        genCtx.lineWidth = 1.25;
        genCtx.stroke();
      }
      for (let p = 0; p < stroke.points.length; p++) {
        const ax = stroke.points[p][0] + model.offsetX;
        const ay = stroke.points[p][1] + model.offsetY;
        genCtx.fillStyle = color;
        genCtx.beginPath();
        genCtx.arc(ax, ay, 2.0, 0, Math.PI * 2);
        genCtx.fill();
      }
    }
  }

  const refAlpha = refAlphaByGlyph.get(model.id);
  if (!refAlpha) {
    return null;
  }

  drawAlphaAsInk(refCanvas, refAlpha);

  diffCanvas.width = VIEWBOX_SIZE;
  diffCanvas.height = VIEWBOX_SIZE;
  const diffCtx = diffCanvas.getContext('2d');
  if (!diffCtx) return null;

  const diffImg = diffCtx.createImageData(VIEWBOX_SIZE, VIEWBOX_SIZE);
  const dd = diffImg.data;

  let sse = 0;
  let interSum = 0;
  let unionSum = 0;
  let missingSum = 0;
  let extraSum = 0;
  let refSum = 0;

  for (let p = 0; p < PIXEL_COUNT; p++) {
    const ra = refAlpha[p];
    const ga = genAlpha[p];
    const delta = ra - ga;
    sse += delta * delta;

    const minA = ra < ga ? ra : ga;
    const maxA = ra > ga ? ra : ga;
    interSum += minA;
    unionSum += maxA;
    refSum += ra;

    const idx = p * 4;
    const matchedBase = (minA / 255) * 58;
    if (delta > 0) {
      missingSum += delta;
      const err = Math.min(1, (delta / 255) * 1.45);
      dd[idx] = Math.min(255, Math.round(15 + matchedBase + err * 240));
      dd[idx + 1] = Math.min(255, Math.round(23 + matchedBase + err * 45));
      dd[idx + 2] = Math.min(255, Math.round(42 + matchedBase + err * 68));
    } else if (delta < 0) {
      extraSum += -delta;
      const err = Math.min(1, (-delta / 255) * 1.45);
      dd[idx] = Math.min(255, Math.round(15 + matchedBase + err * 12));
      dd[idx + 1] = Math.min(255, Math.round(23 + matchedBase + err * 212));
      dd[idx + 2] = Math.min(255, Math.round(42 + matchedBase + err * 213));
    } else {
      dd[idx] = Math.round(15 + matchedBase);
      dd[idx + 1] = Math.round(23 + matchedBase);
      dd[idx + 2] = Math.round(42 + matchedBase);
    }
    dd[idx + 3] = 255;
  }

  diffCtx.putImageData(diffImg, 0, 0);

  const rmse = Math.sqrt(sse / PIXEL_COUNT);
  const iouPct = unionSum > 0 ? (interSum / unionSum) * 100 : 100;
  const denom = refSum > 0 ? refSum : 1;

  return {
    rmse,
    iouPct,
    missingInkPct: (missingSum / denom) * 100,
    extraInkPct: (extraSum / denom) * 100,
  };
}
