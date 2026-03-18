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

// Rings: dark filled text band annulus + inner border ring. (Outer ring moved to merged base)
export function buildRingsSvg(cx: number, cy: number, p: LogoParams): string {
  const yinYangBorderWidth = 1.5;
  const yinYangOuterR = p.yinYangRadius + yinYangBorderWidth / 2; // Exact geometric edge of the black border
  
  const innerRingCenterR = yinYangOuterR + p.innerRingWidth / 2;
  const bandInnerR = yinYangOuterR + p.innerRingWidth + p.innerRingGap;
  const bandOuterR = bandInnerR + p.textBandWidth;

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

  return parts.join('');
}

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
// Merged Outer Base (Venn Technique)
// ---------------------------------------------------------------------------

// Replaces the solid background circle, outer border ring, spokes, and tips.
// Draws them all as a single united shape using the Two-Pass Silhouette pattern.
export function buildMergedOuterBaseSvg(cx: number, cy: number, p: LogoParams): string {
  const yinYangBorderWidth = 1.5;
  const outerRingInnerEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap;
  const outerRingOuterEdge = outerRingInnerEdge + p.outerRingWidth;

  const shapes: string[] = [];

  // 1. The outer circle (extends to the inner edge of the outer ring stroke)
  shapes.push(`<circle cx="${cx}" cy="${cy}" r="${outerRingInnerEdge}"/>`);

  for (let i = 0; i < 8; i++) {
    const angleDeg = i * 45;
    const angle = angleDeg * Math.PI / 180;
    const isCardinal = angleDeg % 90 === 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perpCos = Math.cos(angle + Math.PI / 2);
    const perpSin = Math.sin(angle + Math.PI / 2);

    // 2. Tips
    const tipStart = outerRingOuterEdge + (isCardinal ? p.cardinalTipDistance : p.diagonalTipDistance);
    const tipLen = isCardinal ? p.cardinalTipLength : p.diagonalTipLength;
    const tipW = isCardinal ? p.cardinalTipWidth : p.diagonalTipWidth;
    if (tipLen > 0 && tipW > 0) {
      if (isCardinal) {
        const halfW = tipW / 2;
        const baseR = tipStart;
        const tipR = tipStart + tipLen;
        const bumpR = tipW * 0.28;
        const baseSpikeW = Math.max(0, halfW - bumpR * 0.6); 
        
        // Spike Path
        const bx1 = cx + baseR * cos - baseSpikeW * perpCos;
        const by1 = cy + baseR * sin - baseSpikeW * perpSin;
        const bx2 = cx + baseR * cos + baseSpikeW * perpCos;
        const by2 = cy + baseR * sin + baseSpikeW * perpSin;
        const tx = cx + tipR * cos;
        const ty = cy + tipR * sin;
        
        const cpOffset = baseSpikeW * p.cardinalTipConcavity;
        const midR = baseR + tipLen * 0.4;
        const cp1x = cx + midR * cos - (baseSpikeW - cpOffset) * perpCos;
        const cp1y = cy + midR * sin - (baseSpikeW - cpOffset) * perpSin;
        const cp2x = cx + midR * cos + (baseSpikeW - cpOffset) * perpCos;
        const cp2y = cy + midR * sin + (baseSpikeW - cpOffset) * perpSin;
        shapes.push(`<path d="M ${bx1},${by1} Q ${cp1x},${cp1y} ${tx},${ty} Q ${cp2x},${cp2y} ${bx2},${by2} Z"/>`);

        // Side Bumps
        const leftBumpX = cx + baseR * cos - (halfW - bumpR) * perpCos;
        const leftBumpY = cy + baseR * sin - (halfW - bumpR) * perpSin;
        const rightBumpX = cx + baseR * cos + (halfW - bumpR) * perpCos;
        const rightBumpY = cy + baseR * sin + (halfW - bumpR) * perpSin;
        shapes.push(`<circle cx="${leftBumpX}" cy="${leftBumpY}" r="${bumpR}"/>`);
        shapes.push(`<circle cx="${rightBumpX}" cy="${rightBumpY}" r="${bumpR}"/>`);

        // Third Bump (Center base)
        if (p.cardinalTipThirdBumpRadius > 0) {
          const bumpDist = tipStart + p.cardinalTipThirdBumpDistance;
          const thirdBumpX = cx + bumpDist * cos;
          const thirdBumpY = cy + bumpDist * sin;
          shapes.push(`<!-- Third central bump -->`);
          shapes.push(`<circle cx="${thirdBumpX}" cy="${thirdBumpY}" r="${p.cardinalTipThirdBumpRadius}"/>`);
        }
      } else {
        // Diagonal Circle
        const radius = tipW / 2;
        const dist = tipStart + Math.max(0, tipLen - radius);
        const cx_circle = cx + dist * cos;
        const cy_circle = cy + dist * sin;
        shapes.push(`<circle cx="${cx_circle}" cy="${cy_circle}" r="${radius}"/>`);
      }
    }
  }

  const joinedShapes = shapes.map(s => '    ' + s).join('\n');
  
  // Pass 1: Silhouette outline for merged outer structure
  return `
  <!-- Pass 1: Silhouette outline for merged outer structure -->
  <g fill="${p.strokeColor}" stroke="${p.strokeColor}" stroke-width="${p.outerRingWidth * 2}" stroke-linejoin="round">
${joinedShapes}
  </g>
  <!-- Pass 2: Knockout fill for merged outer structure (white) -->
  <g fill="${p.fillLight}" stroke="none">
${joinedShapes}
  </g>
  `;
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

  // Build layers inside-out
  // 1. Base Merged Layer (Base white circle, outer ring border, spokes, tips)
  parts.push(buildMergedOuterBaseSvg(cx, cy, p));
  // 2. Yin-Yang (Center)
  parts.push(buildYinYangSvg(cx, cy, p));
  // 3. Rings (Text band annulus and inner ring border)
  parts.push(buildRingsSvg(cx, cy, p));
  // 4. Text
  parts.push(buildTextSvg(cx, cy, p));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="${viewSize}" height="${viewSize}">`,
    parts.join('\n'),
    '</svg>',
  ].join('\n');
}
