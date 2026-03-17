/* Logo Maker – SVG geometry builders.
 *
 * Pure functions that generate SVG markup strings for each layer of the logo:
 * yin-yang, rings, text arcs, spokes, ornamental tips, and full SVG assembly.
 */

import { LogoParams } from './types.js';

// ---------------------------------------------------------------------------
// Yin-yang
// ---------------------------------------------------------------------------

// Yin-yang S-curve path (dark half).
// sweep-flag=0 makes the dark half bulge LEFT (matching the reference image).
// Path starts from BOTTOM, arcs to TOP — flipped on x-axis.
function buildYinPath(cx: number, cy: number, R: number): string {
  const r = R / 2;
  const top = cy - R;
  const bottom = cy + R;
  const mid = cy;
  return [
    `M ${cx} ${bottom}`,
    `A ${R} ${R} 0 1 1 ${cx} ${top}`,
    `A ${r} ${r} 0 0 0 ${cx} ${mid}`,
    `A ${r} ${r} 0 0 1 ${cx} ${bottom}`,
    'Z',
  ].join(' ');
}

export function buildYinYangSvg(cx: number, cy: number, p: LogoParams): string {
  const R = p.yinYangRadius;
  const eyeOffset = R * p.yinYangEyePosition;
  const yinPath = buildYinPath(cx, cy, R);

  const parts: string[] = [];
  // Light (yang) base circle
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${p.fillLight}"/>`);
  // Dark (yin) S-curve half
  parts.push(`<path d="${yinPath}" fill="${p.fillDark}"/>`);
  // Eyes (swapped: dark eye on top in light half, white eye on bottom in dark half)
  if (p.yinYangEyeRadius > 0) {
    parts.push(`<circle cx="${cx}" cy="${cy - eyeOffset}" r="${p.yinYangEyeRadius}" fill="${p.fillDark}"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy + eyeOffset}" r="${p.yinYangEyeRadius}" fill="${p.fillLight}"/>`);
  }
  // Border
  const yinYangBorderWidth = 1.5;
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${p.strokeColor}" stroke-width="${yinYangBorderWidth}"/>`);

  // Wrap in rotation group
  if (p.yinYangRotation !== 0) {
    return `<g transform="rotate(${p.yinYangRotation}, ${cx}, ${cy})">${parts.join('')}</g>`;
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------

// Rings: dark filled text band annulus + border rings.
export function buildRingsSvg(cx: number, cy: number, p: LogoParams): string {
  const yinYangBorderWidth = 1.5;
  const yinYangOuterR = p.yinYangRadius + yinYangBorderWidth / 2; // Exact geometric edge of the black border
  
  const innerRingCenterR = yinYangOuterR + p.innerRingWidth / 2;
  const bandInnerR = yinYangOuterR + p.innerRingWidth + p.innerRingGap;
  const bandOuterR = bandInnerR + p.textBandWidth;
  const outerRingCenterR = bandOuterR + p.outerRingGap + p.outerRingWidth / 2;

  // Draw a filled annulus using a path with two concentric arcs (even-odd fill).
  const annulusPath = [
    // Outer circle (clockwise)
    `M ${cx + bandOuterR} ${cy}`,
    `A ${bandOuterR} ${bandOuterR} 0 1 1 ${cx - bandOuterR} ${cy}`,
    `A ${bandOuterR} ${bandOuterR} 0 1 1 ${cx + bandOuterR} ${cy}`,
    // Inner circle (counter-clockwise to cut out)
    `M ${cx + bandInnerR} ${cy}`,
    `A ${bandInnerR} ${bandInnerR} 0 1 0 ${cx - bandInnerR} ${cy}`,
    `A ${bandInnerR} ${bandInnerR} 0 1 0 ${cx + bandInnerR} ${cy}`,
    'Z',
  ].join(' ');

  const parts: string[] = [];
  // Filled dark annulus for text band background
  parts.push(`<path d="${annulusPath}" fill="${p.fillDark}" fill-rule="evenodd"/>`);

  // Inner border ring
  if (p.innerRingWidth > 0) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${innerRingCenterR}" fill="none" stroke="${p.strokeColor}" stroke-width="${p.innerRingWidth}"/>`);
  }

  // Outer border ring
  if (p.outerRingWidth > 0) {
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerRingCenterR}" fill="none" stroke="${p.strokeColor}" stroke-width="${p.outerRingWidth}"/>`);
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

// Text along circular arcs using <textPath>.
export function buildTextSvg(cx: number, cy: number, p: LogoParams): string {
  // The text band center radius
  const yinYangBorderWidth = 1.5;
  const yinYangOuterR = p.yinYangRadius + yinYangBorderWidth / 2;
  const bandInnerR = yinYangOuterR + p.innerRingWidth + p.innerRingGap;
  const bandCenterR = bandInnerR + p.textBandWidth / 2;
  const parts: string[] = [];

  // Upper arc for Chinese characters (意 力 拳): arc going clockwise over the top.
  // We draw a circular arc path and attach <textPath> to it.
  const upperR = bandCenterR + p.textOffsetUpper;
  // Semicircular arc from left to right over the top
  parts.push(`<defs>`);
  parts.push(`  <path id="upper-arc" d="M ${cx - upperR} ${cy} A ${upperR} ${upperR} 0 1 1 ${cx + upperR} ${cy}" fill="none"/>`);
  // Lower arc for "I LIQ CHUAN": goes left-to-right through the bottom.
  // sweep-flag=0 makes the arc take the lower (longer) path around the bottom.
  const lowerR = bandCenterR + p.textOffsetLower;
  parts.push(`  <path id="lower-arc" d="M ${cx - lowerR} ${cy} A ${lowerR} ${lowerR} 0 1 0 ${cx + lowerR} ${cy}" fill="none"/>`);
  parts.push(`</defs>`);

  // Chinese text (upper arc) — rendered in light color on the dark band
  parts.push(`<text font-size="${p.textSizeUpper}" fill="${p.fillLight}" font-family="'Noto Serif SC', 'SimSun', serif" font-weight="700">`);
  parts.push(`  <textPath href="#upper-arc" startOffset="50%" text-anchor="middle">意 力 拳</textPath>`);
  parts.push(`</text>`);

  // Latin text (lower arc) — rendered in light color on the dark band
  parts.push(`<text font-size="${p.textSizeLower}" fill="${p.fillLight}" font-family="'Times New Roman', 'Noto Serif', serif" font-weight="700" letter-spacing="${p.textLetterSpacingLower}">`);
  parts.push(`  <textPath href="#lower-arc" startOffset="50%" text-anchor="middle">I  LIQ  CHUAN</textPath>`);
  parts.push(`</text>`);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Spokes
// ---------------------------------------------------------------------------

// 8 spokes radiating from the outer ring.
export function buildSpokesSvg(cx: number, cy: number, p: LogoParams): string {
  const yinYangBorderWidth = 1.5;
  const outerRingOuterEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
  const parts: string[] = [];

  for (let i = 0; i < 8; i++) {
    const angle = (i * 45) * Math.PI / 180;
    const startR = outerRingOuterEdge;
    const endR = outerRingOuterEdge + p.spokeLength;

    // Spoke is a narrow rectangle rotated to the angle
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perpCos = Math.cos(angle + Math.PI / 2);
    const perpSin = Math.sin(angle + Math.PI / 2);
    const hw = p.spokeWidth / 2;

    const x1 = cx + startR * cos - hw * perpCos;
    const y1 = cy + startR * sin - hw * perpSin;
    const x2 = cx + startR * cos + hw * perpCos;
    const y2 = cy + startR * sin + hw * perpSin;
    const x3 = cx + endR * cos + hw * perpCos;
    const y3 = cy + endR * sin + hw * perpSin;
    const x4 = cx + endR * cos - hw * perpCos;
    const y4 = cy + endR * sin - hw * perpSin;

    parts.push(`<polygon points="${x1},${y1} ${x2},${y2} ${x3},${y3} ${x4},${y4}" fill="${p.strokeColor}"/>`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Ornamental Tips
// ---------------------------------------------------------------------------

// Ornamental tips at the end of each spoke.
// Cardinal (N,E,S,W) — trefoil shape made of overlapping circles
// Diagonal (NE,SE,SW,NW) — simple perfect circle
export function buildTipsSvg(cx: number, cy: number, p: LogoParams): string {
  const yinYangBorderWidth = 1.5;
  const outerRingOuterEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
  const tipStart = outerRingOuterEdge + p.spokeLength;
  const parts: string[] = [];
  const silhouettes: string[] = [];
  const interiorsCardinal: string[] = [];
  const interiorsDiagonal: string[] = [];

  const addShape = (svgShape: string) => {
    silhouettes.push(svgShape);
    interiorsCardinal.push(svgShape);
  };

  for (let i = 0; i < 8; i++) {
    const angleDeg = i * 45;
    const angle = angleDeg * Math.PI / 180;
    const isCardinal = angleDeg % 90 === 0;

    const tipLen = isCardinal ? p.cardinalTipLength : p.diagonalTipLength;
    const tipW = isCardinal ? p.cardinalTipWidth : p.diagonalTipWidth;

    if (tipLen <= 0 || tipW <= 0) continue;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perpCos = Math.cos(angle + Math.PI / 2);
    const perpSin = Math.sin(angle + Math.PI / 2);



    if (isCardinal) {
      // Cardinal tips:
      // The flanking semi-circles sit exactly on the outer ring (tipStart).
      // The central spike protrudes OUTWARD starting from between the side circles.
      // This immediately removes the "thin neck".
      
      const halfW = tipW / 2;
      const baseR = tipStart;
      const tipR = tipStart + tipLen;
      const concavity = p.cardinalTipConcavity;

      // Flanking decorative circles (semi-circles visible from outside the ring)
      const bumpR = tipW * 0.28;
      
      // The spike base width fits comfortably between the bumps
      const baseSpikeW = Math.max(0, halfW - bumpR * 0.6); 

      // Spike base points
      const bx1 = cx + baseR * cos - baseSpikeW * perpCos;
      const by1 = cy + baseR * sin - baseSpikeW * perpSin;
      const bx2 = cx + baseR * cos + baseSpikeW * perpCos;
      const by2 = cy + baseR * sin + baseSpikeW * perpSin;

      // Tip point (sharp or slightly rounded via stroke cap)
      const tx = cx + tipR * cos;
      const ty = cy + tipR * sin;

      // Control point offset for the concave curve from base to tip
      const cpOffset = baseSpikeW * concavity;
      const midR = tipStart + tipLen * 0.4;
      const cp1x = cx + midR * cos - (baseSpikeW - cpOffset) * perpCos;
      const cp1y = cy + midR * sin - (baseSpikeW - cpOffset) * perpSin;
      const cp2x = cx + midR * cos + (baseSpikeW - cpOffset) * perpCos;
      const cp2y = cy + midR * sin + (baseSpikeW - cpOffset) * perpSin;

      // Silhouette path for the spike
      const path_sil = `M ${bx1},${by1} Q ${cp1x},${cp1y} ${tx},${ty} Q ${cp2x},${cp2y} ${bx2},${by2} Z`;
      silhouettes.push(`<path d="${path_sil}"/>`);

      // Place flanking circles precisely on baseR
      const leftBumpX = cx + baseR * cos - (halfW - bumpR) * perpCos;
      const leftBumpY = cy + baseR * sin - (halfW - bumpR) * perpSin;
      const rightBumpX = cx + baseR * cos + (halfW - bumpR) * perpCos;
      const rightBumpY = cy + baseR * sin + (halfW - bumpR) * perpSin;

      addShape(`<circle cx="${leftBumpX}" cy="${leftBumpY}" r="${bumpR}"/>`);
      addShape(`<circle cx="${rightBumpX}" cy="${rightBumpY}" r="${bumpR}"/>`);

      // Always cut through the outer ring stroke at cardinal tip positions.
      // The white outer gap must seamlessly flow into the decorations.
      const ringCut = p.outerRingWidth + 1.5;
      const ibx1 = cx + (baseR - ringCut) * cos - baseSpikeW * perpCos;
      const iby1 = cy + (baseR - ringCut) * sin - baseSpikeW * perpSin;
      const ibx2 = cx + (baseR - ringCut) * cos + baseSpikeW * perpCos;
      const iby2 = cy + (baseR - ringCut) * sin + baseSpikeW * perpSin;
      const path_int = `M ${ibx1},${iby1} L ${bx1},${by1} Q ${cp1x},${cp1y} ${tx},${ty} Q ${cp2x},${cp2y} ${bx2},${by2} L ${ibx2},${iby2} Z`;
      interiorsCardinal.push(`<path d="${path_int}"/>`);

      // Wide rectangular cutout spanning the FULL decoration width to completely
      // erase the outer ring stroke arc under the entire cardinal tip footprint.
      {
        const fullCutW = halfW + bumpR * 0.3; // slightly wider than the outermost bump edge
        const cutInnerR = baseR - ringCut;     // cut inward past the ring stroke
        const cutOuterR = baseR + bumpR * 0.5; // extend slightly outward past the ring stroke center

        const c1x = cx + cutInnerR * cos - fullCutW * perpCos;
        const c1y = cy + cutInnerR * sin - fullCutW * perpSin;
        const c2x = cx + cutInnerR * cos + fullCutW * perpCos;
        const c2y = cy + cutInnerR * sin + fullCutW * perpSin;
        const c3x = cx + cutOuterR * cos + fullCutW * perpCos;
        const c3y = cy + cutOuterR * sin + fullCutW * perpSin;
        const c4x = cx + cutOuterR * cos - fullCutW * perpCos;
        const c4y = cy + cutOuterR * sin - fullCutW * perpSin;

        interiorsCardinal.push(`<polygon points="${c1x},${c1y} ${c2x},${c2y} ${c3x},${c3y} ${c4x},${c4y}"/>`);
      }
    } else {
      // Diagonal tips: simple single perfect circle
      const radius = tipW / 2;
      const dist = tipStart + Math.max(0, tipLen - radius);
      const cx_circle = cx + dist * cos;
      const cy_circle = cy + dist * sin;

      silhouettes.push(`<circle cx="${cx_circle}" cy="${cy_circle}" r="${radius}"/>`);
      interiorsDiagonal.push(`<circle cx="${cx_circle}" cy="${cy_circle}" r="${radius}"/>`);

      // Always cut through the outer ring stroke at diagonal tip positions.
      // The white area must naturally flow into the circles at the 45 degree points.
      const ringCut = p.outerRingWidth + 1.5;
      const d_center = Math.abs(dist - tipStart);
      if (d_center < radius * 1.5) {
        // Find width of circle intersection at the outer ring radius
        let cutWidth = radius;
        if (d_center < radius) {
          cutWidth = Math.sqrt(radius * radius - d_center * d_center);
        }

        const cutX1_sil = cx + tipStart * cos - cutWidth * perpCos;
        const cutY1_sil = cy + tipStart * sin - cutWidth * perpSin;
        const cutX2_sil = cx + tipStart * cos + cutWidth * perpCos;
        const cutY2_sil = cy + tipStart * sin + cutWidth * perpSin;

        // Silhouette connects to the ring stroke
        const polySil = `<polygon points="${cutX1_sil},${cutY1_sil} ${cutX2_sil},${cutY2_sil} ${cx_circle},${cy_circle}"/>`;
        silhouettes.push(polySil);
        
        // Inner cut completely punches through the ring stroke
        const innerHW = cutWidth * 0.95; 
        const cutX1 = cx + (tipStart - ringCut) * cos - innerHW * perpCos;
        const cutY1 = cy + (tipStart - ringCut) * sin - innerHW * perpSin;
        const cutX2 = cx + (tipStart - ringCut) * cos + innerHW * perpCos;
        const cutY2 = cy + (tipStart - ringCut) * sin + innerHW * perpSin;
        
        const polyInt = `<polygon points="${cutX1},${cutY1} ${cutX2},${cutY2} ${cx_circle},${cy_circle}"/>`;
        interiorsDiagonal.push(polyInt);
      }
    }
  }

  if (silhouettes.length > 0) {
    // Pass 1: Silhouette expansion (fills with dark color, strokes with dark color)
    parts.push(`<g fill="${p.strokeColor}" stroke="${p.strokeColor}" stroke-width="2.5" stroke-linejoin="round">`);
    parts.push(...silhouettes);
    parts.push(`</g>`);

    // Pass 2: Interior filling for Cardinal tips
    // [USER REQUEST] Color cardinal decorations fill green
    parts.push(`<g fill="green" stroke="none">`);
    parts.push(...interiorsCardinal);
    parts.push(`</g>`);

    // Pass 2: Interior filling for Diagonal tips
    // [USER REQUEST] Color diagonal (45 degree) decorations fill blue
    parts.push(`<g fill="blue" stroke="none">`);
    parts.push(...interiorsDiagonal);
    parts.push(`</g>`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Full SVG assembly
// ---------------------------------------------------------------------------

export function computeViewSize(p: LogoParams): number {
  return 400; // Fixed size so optimization scaling is stable and 1:1 with diff canvas
}

export function buildFullSvg(p: LogoParams, size?: number): string {
  const viewSize = size || computeViewSize(p);
  const cx = viewSize / 2;
  const cy = viewSize / 2;

  const parts: string[] = [];

  // Background
  if (!p.transparentBg) {
    parts.push(`<rect width="${viewSize}" height="${viewSize}" fill="${p.bgColor}"/>`);
  }

  // [USER REQUEST] "outer-decoration circle"
  // This provides the solid white background behind the logo, up to the outer ring.
  // Colored red temporarily to verify it is the correct element to merge.
  const yinYangBorderWidth = 1.5;
  const outerEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerEdge}" fill="red" stroke="none"/>`);

  // Build layers inside-out
  parts.push(buildYinYangSvg(cx, cy, p));
  parts.push(buildRingsSvg(cx, cy, p));
  parts.push(buildTextSvg(cx, cy, p));
  parts.push(buildSpokesSvg(cx, cy, p));
  parts.push(buildTipsSvg(cx, cy, p));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${viewSize}" height="${viewSize}">`,
    parts.join('\n'),
    '</svg>',
  ].join('\n');
}
