/* Variable-width calligraphic stroke geometry and SVG builder.
 *
 * Each stroke is defined by N >= 2 anchor points [x, y, r] along its medial axis.
 * We interpolate [x(t), y(t), r(t)] via centripetal Catmull-Rom splines, then
 * compute the outer envelope of the swept disks D(P(s), r(s)) with inner-disk
 * culling so tight corners and hooks produce clean, self-intersection-free SVG paths.
 */

import { sanitizeHexColor } from './defaults.js';
import {
  AnchorPoint,
  CharacterModel,
  ExportOptions,
  StrokeDef,
  VIEWBOX_SIZE,
} from './types.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SampledPoint {
  x: number;
  y: number;
  r: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Samples [x, y, r] along a centripetal Catmull-Rom spline in viewBox space.
export function sampleCatmullRom3D(
  points: readonly AnchorPoint[],
  radiusScale: number,
  offsetX: number,
  offsetY: number,
  stepPx = 1.4,
): SampledPoint[] {
  const n = points.length;
  if (n === 0) return [];

  const transformed: SampledPoint[] = points.map((p) => ({
    x: p[0] + offsetX,
    y: p[1] + offsetY,
    r: Math.max(0.35, p[2] * radiusScale),
  }));

  if (n === 1) {
    return [transformed[0]];
  }

  const out: SampledPoint[] = [{ ...transformed[0] }];
  for (let i = 0; i < n - 1; i++) {
    const p1 = transformed[i];
    const p2 = transformed[i + 1];
    const p0: SampledPoint =
      i > 0
        ? transformed[i - 1]
        : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, r: p1.r };
    const p3: SampledPoint =
      i + 2 < n
        ? transformed[i + 2]
        : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, r: p2.r };

    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (segLen < 1e-4) {
      continue;
    }

    // Centripetal parameterization (alpha = 0.5 => sqrt of chord length).
    const d1 = Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)) + 1e-4;
    const d2 = Math.sqrt(segLen) + 1e-4;
    const d3 = Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)) + 1e-4;

    const denom1 = 3 * d1 * (d1 + d2);
    const denom2 = 3 * d3 * (d3 + d2);
    const c1 = 2 * d1 * d1 + 3 * d1 * d2 + d2 * d2;
    const c2 = 2 * d3 * d3 + 3 * d3 * d2 + d2 * d2;

    const b1x = (d1 * d1 * p2.x - d2 * d2 * p0.x + c1 * p1.x) / denom1;
    const b1y = (d1 * d1 * p2.y - d2 * d2 * p0.y + c1 * p1.y) / denom1;
    const b1r = (d1 * d1 * p2.r - d2 * d2 * p0.r + c1 * p1.r) / denom1;

    const b2x = (d3 * d3 * p1.x - d2 * d2 * p3.x + c2 * p2.x) / denom2;
    const b2y = (d3 * d3 * p1.y - d2 * d2 * p3.y + c2 * p2.y) / denom2;
    const b2r = (d3 * d3 * p1.r - d2 * d2 * p3.r + c2 * p2.r) / denom2;

    const subSteps = Math.max(2, Math.ceil(segLen / stepPx));
    for (let s = 1; s <= subSteps; s++) {
      const t = s / subSteps;
      const mt = 1 - t;
      const w0 = mt * mt * mt;
      const w1 = 3 * mt * mt * t;
      const w2 = 3 * mt * t * t;
      const w3 = t * t * t;
      const x = w0 * p1.x + w1 * b1x + w2 * b2x + w3 * p2.x;
      const y = w0 * p1.y + w1 * b1y + w2 * b2y + w3 * p2.y;
      const r = Math.max(0.35, w0 * p1.r + w1 * b1r + w2 * b2r + w3 * p2.r);
      const prev = out[out.length - 1];
      if (Math.hypot(x - prev.x, y - prev.y) > 0.05 || s === subSteps) {
        out.push({ x, y, r });
      }
    }
  }

  return out;
}

function isInsideOtherDisk(
  qx: number,
  qy: number,
  sourceIdx: number,
  samples: readonly SampledPoint[],
): boolean {
  const m = samples.length;
  for (let j = 0; j < m; j++) {
    if (j === sourceIdx) continue;
    const sj = samples[j];
    const shrinkR = sj.r - 0.08;
    if (shrinkR <= 0) continue;
    const dx = qx - sj.x;
    const dy = qy - sj.y;
    if (dx * dx + dy * dy < shrinkR * shrinkR) {
      return true;
    }
  }
  return false;
}

function buildCirclePath(cx: number, cy: number, r: number): string {
  const rr = Math.max(0.35, r);
  const f = (n: number): string => n.toFixed(2);
  return (
    `M ${f(cx - rr)} ${f(cy)} ` +
    `A ${f(rr)} ${f(rr)} 0 1 0 ${f(cx + rr)} ${f(cy)} ` +
    `A ${f(rr)} ${f(rr)} 0 1 0 ${f(cx - rr)} ${f(cy)} Z`
  );
}

// Converts a variable-radius stroke into a closed, bowtie-free SVG path string.
export function buildStrokeOutlinePath(
  points: readonly AnchorPoint[],
  radiusScale = 1.0,
  offsetX = 0.0,
  offsetY = 0.0,
): string {
  const samples = sampleCatmullRom3D(points, radiusScale, offsetX, offsetY, 1.4);
  const m = samples.length;
  if (m === 0) return '';
  if (m === 1) {
    return buildCirclePath(samples[0].x, samples[0].y, samples[0].r);
  }

  const txArr = new Float64Array(m);
  const tyArr = new Float64Array(m);
  const sinAArr = new Float64Array(m);
  const cosAArr = new Float64Array(m);

  for (let i = 0; i < m; i++) {
    const prev = samples[i > 0 ? i - 1 : 0];
    const next = samples[i < m - 1 ? i + 1 : m - 1];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const ds = Math.hypot(dx, dy);
    if (ds > 1e-5) {
      txArr[i] = dx / ds;
      tyArr[i] = dy / ds;
      const drDs = (next.r - prev.r) / ds;
      const sinA = clamp(-drDs, -0.92, 0.92);
      sinAArr[i] = sinA;
      cosAArr[i] = Math.sqrt(1 - sinA * sinA);
    } else {
      txArr[i] = i > 0 ? txArr[i - 1] : 1;
      tyArr[i] = i > 0 ? tyArr[i - 1] : 0;
      sinAArr[i] = 0;
      cosAArr[i] = 1;
    }
  }

  const outline: Array<[number, number]> = [];

  // 1. Left side from start (0) to end (m - 1).
  for (let i = 0; i < m; i++) {
    const s = samples[i];
    const tx = txArr[i];
    const ty = tyArr[i];
    const nx = -ty;
    const ny = tx;
    const sinA = sinAArr[i];
    const cosA = cosAArr[i];
    const lx = s.x + s.r * (tx * sinA + nx * cosA);
    const ly = s.y + s.r * (ty * sinA + ny * cosA);
    if (!isInsideOtherDisk(lx, ly, i, samples)) {
      outline.push([lx, ly]);
    }
  }

  // 2. End cap around samples[m - 1] sweeping from left envelope to right envelope via +tangent.
  {
    const endIdx = m - 1;
    const sEnd = samples[endIdx];
    const baseAngle = Math.atan2(tyArr[endIdx], txArr[endIdx]);
    const envOffset = Math.acos(clamp(cosAArr[endIdx], -1, 1));
    // Left envelope normal angle relative to +T is +(pi/2 - alpha) when sinA >= 0; more generally atan2(cosA, sinA).
    const phi = Math.atan2(cosAArr[endIdx], sinAArr[endIdx]);
    void envOffset;
    const capSteps = 8;
    for (let c = 1; c < capSteps; c++) {
      const frac = c / capSteps;
      const ang = baseAngle + phi * (1 - 2 * frac);
      const cx = sEnd.x + sEnd.r * Math.cos(ang);
      const cy = sEnd.y + sEnd.r * Math.sin(ang);
      if (!isInsideOtherDisk(cx, cy, endIdx, samples)) {
        outline.push([cx, cy]);
      }
    }
  }

  // 3. Right side from end (m - 1) back to start (0).
  for (let i = m - 1; i >= 0; i--) {
    const s = samples[i];
    const tx = txArr[i];
    const ty = tyArr[i];
    const nx = -ty;
    const ny = tx;
    const sinA = sinAArr[i];
    const cosA = cosAArr[i];
    const rx = s.x + s.r * (tx * sinA - nx * cosA);
    const ry = s.y + s.r * (ty * sinA - ny * cosA);
    if (!isInsideOtherDisk(rx, ry, i, samples)) {
      outline.push([rx, ry]);
    }
  }

  // 4. Start cap around samples[0] sweeping from right envelope to left envelope via -tangent.
  {
    const sStart = samples[0];
    const baseAngle = Math.atan2(tyArr[0], txArr[0]);
    const phi = Math.atan2(cosAArr[0], sinAArr[0]);
    const startSweep = 2 * Math.PI - 2 * phi;
    const capSteps = 8;
    for (let c = 1; c < capSteps; c++) {
      const frac = c / capSteps;
      const ang = baseAngle - phi - startSweep * frac;
      const cx = sStart.x + sStart.r * Math.cos(ang);
      const cy = sStart.y + sStart.r * Math.sin(ang);
      if (!isInsideOtherDisk(cx, cy, 0, samples)) {
        outline.push([cx, cy]);
      }
    }
  }

  if (outline.length < 3) {
    let maxIdx = 0;
    for (let i = 1; i < m; i++) {
      if (samples[i].r > samples[maxIdx].r) maxIdx = i;
    }
    return buildCirclePath(samples[maxIdx].x, samples[maxIdx].y, samples[maxIdx].r);
  }

  const f = (n: number): string => n.toFixed(2);
  const parts: string[] = [`M ${f(outline[0][0])} ${f(outline[0][1])}`];
  for (let i = 1; i < outline.length; i++) {
    const prev = outline[i - 1];
    const cur = outline[i];
    if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) > 0.04) {
      parts.push(`L ${f(cur[0])} ${f(cur[1])}`);
    }
  }
  parts.push('Z');
  return parts.join(' ');
}

export function buildCharacterPaths(model: CharacterModel): string[] {
  return model.strokes.map((s) =>
    buildStrokeOutlinePath(s.points, model.radiusScale, model.offsetX, model.offsetY),
  );
}

// Produces a clean standalone SVG XML string for download/copy/export (no editor chrome).
export function buildCharacterSvg(
  model: CharacterModel,
  opts: ExportOptions,
): string {
  const fg = sanitizeHexColor(opts.fgColor, '#ffffff');
  const bg = sanitizeHexColor(opts.bgColor, '#111827');
  const paths = buildCharacterPaths(model);

  const lines: string[] = [
    `<svg xmlns="${SVG_NS}" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}" width="${VIEWBOX_SIZE}" height="${VIEWBOX_SIZE}">`,
  ];
  if (!opts.transparentBg) {
    lines.push(
      `  <rect width="${VIEWBOX_SIZE}" height="${VIEWBOX_SIZE}" fill="${bg}"/>`,
    );
  }
  lines.push(`  <g fill="${fg}">`);
  for (let i = 0; i < paths.length; i++) {
    const d = paths[i];
    if (!d) continue;
    lines.push(`    <path d="${d}"/>`);
  }
  lines.push('  </g>');
  lines.push('</svg>');
  return lines.join('\n');
}

// Builds a live SVGSVGElement safely via createElementNS without parsing HTML strings.
export function createCharacterSvgElement(
  model: CharacterModel,
  opts: ExportOptions,
  sizePx?: number,
): SVGSVGElement {
  const fg = sanitizeHexColor(opts.fgColor, '#ffffff');
  const bg = sanitizeHexColor(opts.bgColor, '#111827');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
  if (sizePx !== undefined) {
    svg.setAttribute('width', String(sizePx));
    svg.setAttribute('height', String(sizePx));
  }

  if (!opts.transparentBg) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('width', String(VIEWBOX_SIZE));
    rect.setAttribute('height', String(VIEWBOX_SIZE));
    rect.setAttribute('fill', bg);
    svg.appendChild(rect);
  }

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('fill', fg);
  const paths = buildCharacterPaths(model);
  for (const d of paths) {
    if (!d) continue;
    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('d', d);
    g.appendChild(pathEl);
  }
  svg.appendChild(g);
  return svg;
}

export interface SegmentHit {
  strokeIdx: number;
  insertIndex: number;
  point: AnchorPoint;
  distance: number;
}

// Finds the closest centerline span across all strokes for double-click anchor insertion.
export function findClosestSegmentOnModel(
  model: CharacterModel,
  vx: number,
  vy: number,
): SegmentHit | null {
  let best: SegmentHit | null = null;

  for (let sIdx = 0; sIdx < model.strokes.length; sIdx++) {
    const stroke: StrokeDef = model.strokes[sIdx];
    const pts = stroke.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0] + model.offsetX;
      const ay = pts[i][1] + model.offsetY;
      const ar = pts[i][2];
      const bx = pts[i + 1][0] + model.offsetX;
      const by = pts[i + 1][1] + model.offsetY;
      const br = pts[i + 1][2];

      const dx = bx - ax;
      const dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      const t =
        lenSq > 1e-6
          ? clamp(((vx - ax) * dx + (vy - ay) * dy) / lenSq, 0.08, 0.92)
          : 0.5;
      const px = ax + t * dx;
      const py = ay + t * dy;
      const dist = Math.hypot(vx - px, vy - py);

      if (!best || dist < best.distance) {
        const rawX = Math.round((px - model.offsetX) * 100) / 100;
        const rawY = Math.round((py - model.offsetY) * 100) / 100;
        const rawR = Math.round((ar + t * (br - ar)) * 100) / 100;
        best = {
          strokeIdx: sIdx,
          insertIndex: i + 1,
          point: [rawX, rawY, rawR],
          distance: dist,
        };
      }
    }
  }

  return best;
}
