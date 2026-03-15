/* I Liq Chuan Logo SVG Generator
 *
 * Generates a configurable SVG reproduction of the I Liq Chuan emblem.
 * The logo consists of concentric layers:
 *   1. Yin-yang symbol (center)
 *   2. Inner ring border
 *   3. Text band with Chinese characters (upper arc) and "I LIQ CHUAN" (lower arc)
 *   4. Outer ring border
 *   5. Dharma wheel: 8 spokes with ornamental tips
 *
 * Parameters are read from DOM range/color inputs, and can be persisted to localStorage.
 * A pixel-diff comparison against a reference PNG is available for parameter tuning.
 *
 * Compiled to JS via:
 *   pnpm exec tsc mini-tools/iliqchuan-logo-maker.ts --target ES2020 --module ES2020 --outDir mini-tools/build
 *
 * Loaded by iliqchuan-logo-maker.html as:
 *   <script type="module" src="build/iliqchuan-logo-maker.js"></script>
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogoParams {
  // Yin-yang
  yinYangRadius: number;
  yinYangEyeRadius: number;
  yinYangEyePosition: number; // 0..1, 0.5 = natural
  yinYangRotation: number; // degrees

  // Rings
  innerRingWidth: number;
  innerRingGap: number;
  textBandWidth: number;
  outerRingGap: number;
  outerRingWidth: number;

  // Text
  textSizeUpper: number;
  textSizeLower: number;
  textOffsetUpper: number; // fine-tune arc position
  textOffsetLower: number;
  textLetterSpacingLower: number;

  // Spokes
  spokeLength: number;
  spokeWidth: number;

  // Tips
  cardinalTipLength: number;
  cardinalTipWidth: number;
  diagonalTipLength: number;
  diagonalTipWidth: number;

  // Colors
  strokeColor: string;
  fillLight: string;
  fillDark: string;
  bgColor: string;
  transparentBg: boolean;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = (id: string) => document.getElementById(id)!;

function numVal(id: string): number {
  return parseFloat(($(id) as HTMLInputElement).value);
}

function strVal(id: string): string {
  return ($(id) as HTMLInputElement).value;
}

function boolVal(id: string): boolean {
  return ($(id) as HTMLInputElement).checked;
}

// ---------------------------------------------------------------------------
// Parameter read / write
// ---------------------------------------------------------------------------

function getParams(): LogoParams {
  return {
    yinYangRadius: numVal('yinYangRadius'),
    yinYangEyeRadius: numVal('yinYangEyeRadius'),
    yinYangEyePosition: numVal('yinYangEyePosition') / 100,
    yinYangRotation: numVal('yinYangRotation'),

    innerRingWidth: numVal('innerRingWidth'),
    innerRingGap: numVal('innerRingGap'),
    textBandWidth: numVal('textBandWidth'),
    outerRingGap: numVal('outerRingGap'),
    outerRingWidth: numVal('outerRingWidth'),

    textSizeUpper: numVal('textSizeUpper'),
    textSizeLower: numVal('textSizeLower'),
    textOffsetUpper: numVal('textOffsetUpper'),
    textOffsetLower: numVal('textOffsetLower'),
    textLetterSpacingLower: numVal('textLetterSpacingLower'),

    spokeLength: numVal('spokeLength'),
    spokeWidth: numVal('spokeWidth'),

    cardinalTipLength: numVal('cardinalTipLength'),
    cardinalTipWidth: numVal('cardinalTipWidth'),
    diagonalTipLength: numVal('diagonalTipLength'),
    diagonalTipWidth: numVal('diagonalTipWidth'),

    strokeColor: strVal('strokeColor'),
    fillLight: strVal('fillLight'),
    fillDark: strVal('fillDark'),
    bgColor: strVal('bgColor'),
    transparentBg: boolVal('transparentBg'),
  };
}

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ilc-logo-params';

function saveParams(): void {
  const p = getParams();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    const btn = $('save-btn');
    btn.textContent = '✓ Saved!';
    setTimeout(() => (btn.textContent = 'Save Parameters'), 1500);
  } catch {
    // ignore
  }
}

function loadParams(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as LogoParams;
    setInputVal('yinYangRadius', p.yinYangRadius);
    setInputVal('yinYangEyeRadius', p.yinYangEyeRadius);
    setInputVal('yinYangEyePosition', p.yinYangEyePosition * 100);
    setInputVal('yinYangRotation', p.yinYangRotation);
    setInputVal('innerRingWidth', p.innerRingWidth);
    setInputVal('innerRingGap', p.innerRingGap ?? 4);
    setInputVal('textBandWidth', p.textBandWidth);
    setInputVal('outerRingGap', p.outerRingGap ?? 2);
    setInputVal('outerRingWidth', p.outerRingWidth);
    setInputVal('textSizeUpper', p.textSizeUpper);
    setInputVal('textSizeLower', p.textSizeLower);
    setInputVal('textOffsetUpper', p.textOffsetUpper);
    setInputVal('textOffsetLower', p.textOffsetLower);
    setInputVal('textLetterSpacingLower', p.textLetterSpacingLower);
    setInputVal('spokeLength', p.spokeLength);
    setInputVal('spokeWidth', p.spokeWidth);
    setInputVal('cardinalTipLength', p.cardinalTipLength);
    setInputVal('cardinalTipWidth', p.cardinalTipWidth);
    setInputVal('diagonalTipLength', p.diagonalTipLength);
    setInputVal('diagonalTipWidth', p.diagonalTipWidth);
    setInputVal('strokeColor', p.strokeColor);
    setInputVal('fillLight', p.fillLight);
    setInputVal('fillDark', p.fillDark);
    setInputVal('bgColor', p.bgColor);
    ($(  'transparentBg') as HTMLInputElement).checked = p.transparentBg;
    update();
  } catch {
    // ignore
  }
}

function setInputVal(id: string, val: number | string): void {
  const el = $(id) as HTMLInputElement;
  if (el) el.value = String(val);
}

// ---------------------------------------------------------------------------
// SVG geometry builders
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

function buildYinYangSvg(cx: number, cy: number, p: LogoParams): string {
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

// Rings: dark filled text band annulus + border rings + scalloped inner edge.
function buildRingsSvg(cx: number, cy: number, p: LogoParams): string {
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

// Text along circular arcs using <textPath>.
function buildTextSvg(cx: number, cy: number, p: LogoParams): string {
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

// 8 spokes radiating from the outer ring.
function buildSpokesSvg(cx: number, cy: number, p: LogoParams): string {
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

// Ornamental tips at the end of each spoke.
// Cardinal (N,E,S,W) - vajra/scepter shape with pointed tip, waist, and lobed shoulders
// Diagonal (NE,SE,SW,NW) - smaller simple diamond
function buildTipsSvg(cx: number, cy: number, p: LogoParams): string {
  const yinYangBorderWidth = 1.5;
  const outerRingOuterEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
  const tipStart = outerRingOuterEdge + p.spokeLength;
  const parts: string[] = [];
  const silhouettes: string[] = [];
  const interiors: string[] = [];

  const addShape = (svgShape: string) => {
    silhouettes.push(svgShape);
    interiors.push(svgShape);
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

    // Head circle scaling
    const headR = Math.min(tipW * 0.4, tipLen * 0.5);
    const stemLen = typeof tipLen === 'number' && typeof headR === 'number' ? tipLen - headR : 0;
    const headDist = tipStart + stemLen;
    const headX = cx + headDist * cos;
    const headY = cy + headDist * sin;

    // Side flanking circles
    const sideR = tipW * (isCardinal ? 0.3 : 0.35);
    const sideDist = tipStart + stemLen * (isCardinal ? 0.55 : 0.5);
    const sideOffset = Math.max(0, tipW / 2 - sideR);
    
    const leftX = cx + sideDist * cos - sideOffset * perpCos;
    const leftY = cy + sideDist * sin - sideOffset * perpSin;
    const rightX = cx + sideDist * cos + sideOffset * perpCos;
    const rightY = cy + sideDist * sin + sideOffset * perpSin;

    // Stem bridging outward
    const baseW = tipW * 0.12;
    
    // Silhouettes stay at tipStart so they connect with normal external geometry
    const stemX1_sil = cx + tipStart * cos - baseW * perpCos;
    const stemY1_sil = cy + tipStart * sin - baseW * perpSin;
    const stemX2_sil = cx + tipStart * cos + baseW * perpCos;
    const stemY2_sil = cy + tipStart * sin + baseW * perpSin;
    
    // Interiors cut inward deeper to break through the ring connecting line
    const innerCut = p.spokeLength <= 1 ? p.outerRingWidth + 1.5 : 0;
    const stemX1_int = cx + (tipStart - innerCut) * cos - baseW * perpCos;
    const stemY1_int = cy + (tipStart - innerCut) * sin - baseW * perpSin;
    const stemX2_int = cx + (tipStart - innerCut) * cos + baseW * perpCos;
    const stemY2_int = cy + (tipStart - innerCut) * sin + baseW * perpSin;

    const topX1 = cx + (tipStart + stemLen*0.9) * cos - baseW * perpCos;
    const topY1 = cy + (tipStart + stemLen*0.9) * sin - baseW * perpSin;
    const topX2 = cx + (tipStart + stemLen*0.9) * cos + baseW * perpCos;
    const topY2 = cy + (tipStart + stemLen*0.9) * sin + baseW * perpSin;

    silhouettes.push(`<polygon points="${stemX1_sil},${stemY1_sil} ${stemX2_sil},${stemY2_sil} ${topX2},${topY2} ${topX1},${topY1}"/>`);
    interiors.push(`<polygon points="${stemX1_int},${stemY1_int} ${stemX2_int},${stemY2_int} ${topX2},${topY2} ${topX1},${topY1}"/>`);

    if (p.spokeLength > 1) {
      // Base circle for a nice rounded stem where it connects to a thin spoke line
      const baseR = tipW * 0.15;
      const baseX = cx + tipStart * cos;
      const baseY = cy + tipStart * sin;
      addShape(`<circle cx="${baseX}" cy="${baseY}" r="${baseR}"/>`);
    }

    addShape(`<circle cx="${headX}" cy="${headY}" r="${headR}"/>`);
    addShape(`<circle cx="${leftX}" cy="${leftY}" r="${sideR}"/>`);
    addShape(`<circle cx="${rightX}" cy="${rightY}" r="${sideR}"/>`);
  }

  if (silhouettes.length > 0) {
    // Pass 1: Silhouette expansion (fills with dark color, strokes with dark color)
    parts.push(`<g fill="${p.strokeColor}" stroke="${p.strokeColor}" stroke-width="2.5" stroke-linejoin="round">`);
    parts.push(...silhouettes);
    parts.push(`</g>`);

    // Pass 2: Interior filling (fills with light color overlaying the silhouettes)
    parts.push(`<g fill="${p.fillLight}" stroke="none">`);
    parts.push(...interiors);
    parts.push(`</g>`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Full SVG assembly
// ---------------------------------------------------------------------------

function computeViewSize(p: LogoParams): number {
  return 400; // Fixed size so optimization scaling is stable and 1:1 with diff canvas
}

function buildFullSvg(p: LogoParams, size?: number): string {
  const viewSize = size || computeViewSize(p);
  const cx = viewSize / 2;
  const cy = viewSize / 2;

  const parts: string[] = [];

  // Background
  if (!p.transparentBg) {
    parts.push(`<rect width="${viewSize}" height="${viewSize}" fill="${p.bgColor}"/>`);
  }

  // Solid white interior background (so gaps are white, not transparent!)
  const yinYangBorderWidth = 1.5;
  const outerEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerEdge}" fill="${p.fillLight}" stroke="none"/>`);

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

// ---------------------------------------------------------------------------
// Pixel diff comparison
// ---------------------------------------------------------------------------

let referenceImage: HTMLImageElement | null = null;

function loadReferenceImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function updateDiff(p: LogoParams): Promise<{color: number, alpha: number} | undefined> {
  if (!referenceImage) return;

  const diffSize = 400;
  const refCanvas = $('ref-canvas') as HTMLCanvasElement;
  const genCanvas = $('gen-canvas') as HTMLCanvasElement;
  const diffCanvas = $('diff-canvas') as HTMLCanvasElement;

  refCanvas.width = diffSize;
  refCanvas.height = diffSize;
  genCanvas.width = diffSize;
  genCanvas.height = diffSize;
  diffCanvas.width = diffSize;
  diffCanvas.height = diffSize;

  // Draw reference on transparent canvas (no white fill)
  const refCtx = refCanvas.getContext('2d')!;
  refCtx.clearRect(0, 0, diffSize, diffSize);
  refCtx.drawImage(referenceImage, 0, 0, diffSize, diffSize);

  // Draw generated SVG with transparent background
  const genCtx = genCanvas.getContext('2d')!;
  genCtx.clearRect(0, 0, diffSize, diffSize);

  const svgStr = buildFullSvg({ ...p, transparentBg: true });
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const svgImg = await loadReferenceImage(url);
  genCtx.drawImage(svgImg, 0, 0, diffSize, diffSize);
  URL.revokeObjectURL(url);

  // For color comparison: composite both onto white backgrounds
  // Use off-screen canvases to avoid corrupting visual canvases
  const refWhite = document.createElement('canvas');
  refWhite.width = diffSize; refWhite.height = diffSize;
  const refWhiteCtx = refWhite.getContext('2d')!;
  refWhiteCtx.fillStyle = '#ffffff';
  refWhiteCtx.fillRect(0, 0, diffSize, diffSize);
  refWhiteCtx.drawImage(referenceImage, 0, 0, diffSize, diffSize);

  const genWhite = document.createElement('canvas');
  genWhite.width = diffSize; genWhite.height = diffSize;
  const genWhiteCtx = genWhite.getContext('2d')!;
  genWhiteCtx.fillStyle = '#ffffff';
  genWhiteCtx.fillRect(0, 0, diffSize, diffSize);
  genWhiteCtx.drawImage(svgImg, 0, 0, diffSize, diffSize);

  // Get pixel data
  const refData = refWhiteCtx.getImageData(0, 0, diffSize, diffSize).data;
  const genData = genWhiteCtx.getImageData(0, 0, diffSize, diffSize).data;
  const refRawData = refCtx.getImageData(0, 0, diffSize, diffSize).data;
  const genRawData = genCtx.getImageData(0, 0, diffSize, diffSize).data;
  const diffCtx = diffCanvas.getContext('2d')!;
  const diffImgData = diffCtx.createImageData(diffSize, diffSize);
  const diffData = diffImgData.data;

  let sumSqErrColor = 0;
  let sumSqErrAlpha = 0;
  const totalPixels = diffSize * diffSize;

  for (let i = 0; i < refData.length; i += 4) {
    // Color RMSE: compare composited-on-white RGB values
    const dr = Math.abs(refData[i] - genData[i]);
    const dg = Math.abs(refData[i + 1] - genData[i + 1]);
    const db = Math.abs(refData[i + 2] - genData[i + 2]);
    const diffColor = (dr + dg + db) / 3;
    sumSqErrColor += diffColor * diffColor;

    // Alpha RMSE: derive reference alpha from luminance
    // (white bg reference: white=transparent, dark=opaque)
    const refLum = (refRawData[i] * 0.299 + refRawData[i + 1] * 0.587 + refRawData[i + 2] * 0.114);
    const refAlpha = refRawData[i + 3] > 0 ? 255 - refLum : 0;
    const genAlpha = genRawData[i + 3];
    const da = Math.abs(refAlpha - genAlpha);
    sumSqErrAlpha += da * da;

    // Heatmap: transparent where close, red where different
    diffData[i] = 255;     // R
    diffData[i + 1] = 0;   // G
    diffData[i + 2] = 0;   // B
    diffData[i + 3] = Math.min(255, diffColor * 3); // A — amplified for visibility
  }

  diffCtx.putImageData(diffImgData, 0, 0);

  const rmseColor = Math.sqrt(sumSqErrColor / totalPixels);
  const rmseAlpha = Math.sqrt(sumSqErrAlpha / totalPixels);
  $('rmse-score').textContent = `Color: ${rmseColor.toFixed(2)}  Alpha: ${rmseAlpha.toFixed(2)}`;
  return { color: rmseColor, alpha: rmseAlpha };
}

// ---------------------------------------------------------------------------
// Fast offscreen RMSE computation (for optimization)
// ---------------------------------------------------------------------------

async function computeRMSEFast(p: LogoParams, maskParamKeys?: Array<keyof LogoParams>): Promise<{color: number, alpha: number}> {
  if (!referenceImage) return { color: Infinity, alpha: Infinity };

  const size = 200; // smaller for speed during optimization
  const offRef = document.createElement('canvas');
  offRef.width = size; offRef.height = size;
  const offGen = document.createElement('canvas');
  offGen.width = size; offGen.height = size;

  // Composite reference on white
  const refCtx = offRef.getContext('2d')!;
  refCtx.fillStyle = '#ffffff';
  refCtx.fillRect(0, 0, size, size);
  refCtx.drawImage(referenceImage, 0, 0, size, size);

  // Render generated on white
  const genCtx = offGen.getContext('2d')!;
  genCtx.fillStyle = '#ffffff';
  genCtx.fillRect(0, 0, size, size);

  const svgStr = buildFullSvg({ ...p, transparentBg: false, bgColor: '#ffffff' });
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const svgImg = await loadReferenceImage(url);
  genCtx.drawImage(svgImg, 0, 0, size, size);
  URL.revokeObjectURL(url);

  const refData = refCtx.getImageData(0, 0, size, size).data;
  const genData = genCtx.getImageData(0, 0, size, size).data;
  
  // Calculate mask radius
  let activePixels = 0;
  let maskRadiusSq = Infinity;
  if (maskParamKeys && maskParamKeys.length > 0) {
    let maskR = 0;
    for (const key of maskParamKeys) {
      if (typeof p[key] === 'number') {
        maskR += p[key] as number;
      }
    }
    // Add padding for strokes
    maskR += 2;
    // Map mask to the scaled image size
    const viewSize = computeViewSize(p);
    const scaledMaskR = maskR * (size / viewSize);
    maskRadiusSq = scaledMaskR * scaledMaskR;
  }
  const cx = size / 2;
  const cy = size / 2;

  let sumSqColor = 0;
  let sumSqAlpha = 0;
  for (let i = 0; i < refData.length; i += 4) {
    if (maskRadiusSq !== Infinity) {
      const px = (i / 4) % size;
      const py = Math.floor((i / 4) / size);
      const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (distSq > maskRadiusSq) continue;
    }
    activePixels++;

    const dr = Math.abs(refData[i] - genData[i]);
    const dg = Math.abs(refData[i + 1] - genData[i + 1]);
    const db = Math.abs(refData[i + 2] - genData[i + 2]);
    const d = (dr + dg + db) / 3;
    sumSqColor += d * d;

    // Alpha from luminance
    const refLum = refData[i] * 0.299 + refData[i + 1] * 0.587 + refData[i + 2] * 0.114;
    const refAlpha = 255 - refLum;
    const genLum = genData[i] * 0.299 + genData[i + 1] * 0.587 + genData[i + 2] * 0.114;
    const genAlpha = 255 - genLum;
    const da = Math.abs(refAlpha - genAlpha);
    sumSqAlpha += da * da;
  }

  if (activePixels === 0) activePixels = 1;

  return {
    color: Math.sqrt(sumSqColor / activePixels),
    alpha: Math.sqrt(sumSqAlpha / activePixels),
  };
}

// ---------------------------------------------------------------------------
// Hill-climbing optimizer (coordinate descent)
// ---------------------------------------------------------------------------

// The optimization sequence proceeds in stages to build outwards.
// For each stage, we use a radial mask bounding the outer edge of its components.
export const STAGES: Array<{ name: string, maskKeys: Array<keyof LogoParams>, params: Array<{id: keyof LogoParams, step: number}> }> = [
  {
    name: 'Center',
    maskKeys: ['yinYangRadius'],
    params: [
      { id: 'yinYangRadius', step: 1 },
      { id: 'yinYangEyeRadius', step: 1 },
      { id: 'yinYangEyePosition', step: 1 },
    ],
  },
  {
    name: 'Inner Rings',
    maskKeys: ['yinYangRadius', 'innerRingWidth', 'innerRingGap'],
    params: [
      { id: 'innerRingWidth', step: 0.5 },
      { id: 'innerRingGap', step: 0.5 },
    ],
  },
  {
    name: 'Band',
    maskKeys: ['yinYangRadius', 'innerRingWidth', 'innerRingGap', 'textBandWidth'],
    params: [
      { id: 'textBandWidth', step: 1 },
    ],
  },
  {
    name: 'Outer Rings',
    maskKeys: ['yinYangRadius', 'innerRingWidth', 'innerRingGap', 'textBandWidth', 'outerRingGap', 'outerRingWidth'],
    params: [
      { id: 'outerRingGap', step: 0.5 },
      { id: 'outerRingWidth', step: 0.5 },
    ],
  },
  {
    name: 'Decorations',
    maskKeys: [], // unlimited
    params: [
      { id: 'textSizeUpper', step: 1 },
      { id: 'textSizeLower', step: 1 },
      { id: 'textOffsetUpper', step: 1 },
      { id: 'textOffsetLower', step: 1 },
      { id: 'textLetterSpacingLower', step: 0.5 },
      { id: 'spokeLength', step: 1 },
      { id: 'spokeWidth', step: 0.5 },
      { id: 'cardinalTipLength', step: 1 },
      { id: 'cardinalTipWidth', step: 1 },
      { id: 'diagonalTipLength', step: 1 },
      { id: 'diagonalTipWidth', step: 1 },
    ],
  },
];

let optimizing = false;

async function runOptimization(stagesToRun = STAGES): Promise<void> {
  if (!referenceImage) {
    $('opt-status').textContent = 'Load a reference image first!';
    return;
  }
  if (optimizing) {
    optimizing = false; // signal stop
    return;
  }
  optimizing = true;
  const btn = $('opt-btn');
  btn.textContent = '⏹ Stop';
  const statusEl = $('opt-status');

  let combined = 0;
  const maxPasses = 5;
  let stageIndex = 0;
  
  for (const stage of stagesToRun) {
    if (!optimizing) break;
    stageIndex++;

    for (let pass = 0; pass < maxPasses && optimizing; pass++) {
      let improved = false;

      for (const param of stage.params) {
        if (!optimizing) break;

        const el = $(param.id) as HTMLInputElement;
        const min = parseFloat(el.min);
        const max = parseFloat(el.max);
        const current = parseFloat(el.value);

        let bestVal = current;
        const baseRMSE = await computeRMSEFast(getParams(), stage.maskKeys);
        let bestCombined = baseRMSE.color + baseRMSE.alpha;

        // Try stepping up
        const upVal = Math.min(max, current + param.step);
        if (upVal !== current) {
          el.value = String(upVal);
          const upRMSE = await computeRMSEFast(getParams(), stage.maskKeys);
          const upCombined = upRMSE.color + upRMSE.alpha;
          if (upCombined < bestCombined) {
            bestVal = upVal;
            bestCombined = upCombined;
          }
        }

        // Try stepping down
        const downVal = Math.max(min, current - param.step);
        if (downVal !== current) {
          el.value = String(downVal);
          const downRMSE = await computeRMSEFast(getParams(), stage.maskKeys);
          const downCombined = downRMSE.color + downRMSE.alpha;
          if (downCombined < bestCombined) {
            bestVal = downVal;
            bestCombined = downCombined;
          }
        }

        // Apply best
        el.value = String(bestVal);
        if (bestVal !== current) {
          improved = true;
        }

        statusEl.textContent = `Stage ${stageIndex}/${STAGES.length}: ${stage.name} | Pass ${pass + 1}/${maxPasses} | ${param.id}`;
        combined = bestCombined;

        // Yield to browser for UI updates
        await new Promise(r => setTimeout(r, 0));
      }

      // Full visual update after each pass
      update();
      await new Promise(r => setTimeout(r, 50));

      if (!improved) {
        break; // Converged early on this stage
      }
    }
  }

  statusEl.textContent = `Finished! RMSE: ${combined.toFixed(2)}`;

  optimizing = false;
  btn.textContent = '⚡ Optimize';
  update(); // Final visual update with best values
}

// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------

function downloadPng(targetSize: number): void {
  const p = getParams();
  const svgStr = buildFullSvg(p);

  const canvas = $('export-canvas') as HTMLCanvasElement;
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;

  const img = new Image();
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    ctx.clearRect(0, 0, targetSize, targetSize);
    ctx.drawImage(img, 0, 0, targetSize, targetSize);
    URL.revokeObjectURL(url);

    const a = document.createElement('a');
    a.download = `iliqchuan-logo-${targetSize}x${targetSize}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  img.src = url;
}

// ---------------------------------------------------------------------------
// Main update loop
// ---------------------------------------------------------------------------

function updateLabels(p: LogoParams): void {
  $('yinYangRadius-val').textContent = String(p.yinYangRadius);
  $('yinYangEyeRadius-val').textContent = String(p.yinYangEyeRadius);
  $('yinYangEyePosition-val').textContent = (p.yinYangEyePosition * 100).toFixed(0) + '%';
  $('yinYangRotation-val').textContent = p.yinYangRotation + '°';
  $('innerRingWidth-val').textContent = String(p.innerRingWidth);
  $('innerRingGap-val').textContent = String(p.innerRingGap);
  $('textBandWidth-val').textContent = String(p.textBandWidth);
  $('outerRingGap-val').textContent = String(p.outerRingGap);
  $('outerRingWidth-val').textContent = String(p.outerRingWidth);
  $('textSizeUpper-val').textContent = String(p.textSizeUpper);
  $('textSizeLower-val').textContent = String(p.textSizeLower);
  $('textOffsetUpper-val').textContent = String(p.textOffsetUpper);
  $('textOffsetLower-val').textContent = String(p.textOffsetLower);
  $('textLetterSpacingLower-val').textContent = String(p.textLetterSpacingLower);
  $('spokeLength-val').textContent = String(p.spokeLength);
  $('spokeWidth-val').textContent = String(p.spokeWidth);
  $('cardinalTipLength-val').textContent = String(p.cardinalTipLength);
  $('cardinalTipWidth-val').textContent = String(p.cardinalTipWidth);
  $('diagonalTipLength-val').textContent = String(p.diagonalTipLength);
  $('diagonalTipWidth-val').textContent = String(p.diagonalTipWidth);
}

function update(): void {
  const p = getParams();
  updateLabels(p);

  const viewSize = computeViewSize(p);

  // Build preview SVG
  const previewSvg = $('main-preview') as unknown as SVGSVGElement;
  previewSvg.setAttribute('viewBox', `0 0 ${viewSize} ${viewSize}`);

  const cx = viewSize / 2;
  const cy = viewSize / 2;

  let content = '';
  // Checkerboard background for transparent preview
  if (p.transparentBg) {
    const ps = 12;
    content += `<defs><pattern id="checker" width="${ps * 2}" height="${ps * 2}" patternUnits="userSpaceOnUse">
      <rect width="${ps}" height="${ps}" fill="#ccc"/>
      <rect x="${ps}" y="${ps}" width="${ps}" height="${ps}" fill="#ccc"/>
      <rect x="${ps}" width="${ps}" height="${ps}" fill="#999"/>
      <rect y="${ps}" width="${ps}" height="${ps}" fill="#999"/>
    </pattern></defs>`;
    content += `<rect width="100%" height="100%" fill="url(#checker)" rx="12"/>`;
  } else {
    content += `<rect width="100%" height="100%" fill="${p.bgColor}" rx="12"/>`;
  }

  content += buildYinYangSvg(cx, cy, p);
  content += buildRingsSvg(cx, cy, p);
  content += buildTextSvg(cx, cy, p);
  content += buildSpokesSvg(cx, cy, p);
  content += buildTipsSvg(cx, cy, p);

  // The preview <defs> from text might collide with checker defs,
  // so we inject into a unique namespace — actually the preview SVG
  // is innerHTML-replaced, so each render is clean.
  previewSvg.innerHTML = content;

  // SVG output
  const fullSvg = buildFullSvg(p);
  ($('svg-output') as HTMLTextAreaElement).value = fullSvg;

  // Update diff
  updateDiff(p);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(): void {
  // Wire up all range/color inputs
  const controlIds = [
    'yinYangRadius', 'yinYangEyeRadius', 'yinYangEyePosition', 'yinYangRotation',
    'innerRingWidth', 'innerRingGap', 'textBandWidth', 'outerRingGap', 'outerRingWidth',
    'textSizeUpper', 'textSizeLower', 'textOffsetUpper', 'textOffsetLower', 'textLetterSpacingLower',
    'spokeLength', 'spokeWidth',
    'cardinalTipLength', 'cardinalTipWidth', 'diagonalTipLength', 'diagonalTipWidth',
    'strokeColor', 'fillLight', 'fillDark', 'bgColor',
  ];

  for (const id of controlIds) {
    const el = $(id) as HTMLInputElement;
    el.addEventListener('input', update);
  }

  $('transparentBg').addEventListener('change', update);

  // Save / Load
  $('save-btn').addEventListener('click', saveParams);
  $('load-btn').addEventListener('click', () => {
    loadParams();
    const btn = $('load-btn');
    btn.textContent = '✓ Loaded!';
    setTimeout(() => (btn.textContent = 'Load Parameters'), 1500);
  });

  // Copy SVG
  $('copy-svg-btn').addEventListener('click', () => {
    const text = ($('svg-output') as HTMLTextAreaElement).value;
    navigator.clipboard.writeText(text).then(() => {
      $('copy-svg-btn').textContent = '✓ Copied!';
      setTimeout(() => ($('copy-svg-btn').textContent = 'Copy SVG'), 1500);
    });
  });

  // PNG downloads
  $('download-png-192').addEventListener('click', () => downloadPng(192));
  $('download-png-512').addEventListener('click', () => downloadPng(512));

  // Optimize button
  $('opt-btn').addEventListener('click', () => runOptimization());

  // Inject per-property optimize buttons
  controlIds.forEach(id => {
    let stageForParam = STAGES.find(s => s.params.some(p => p.id === id));
    if (stageForParam) {
      const label = $(`${id}-val`)?.parentElement;
      if (label) {
        const btn = document.createElement('button');
        btn.className = 'opt-btn-small';
        btn.textContent = '⚡';
        btn.title = 'Optimize this property';
        btn.addEventListener('click', () => {
          const paramDef = stageForParam!.params.find(p => p.id === id)!;
          runOptimization([{
            name: `Optimize ${id}`,
            maskKeys: stageForParam!.maskKeys,
            params: [paramDef]
          }]);
        });
        label.appendChild(btn);
      }
    }
  });

  // Inject per-group optimize buttons
  document.querySelectorAll('.section-title').forEach(section => {
    const sectionName = section.textContent?.trim() || '';
    const paramsInGroup: Array<{id: keyof LogoParams, step: number}> = [];
    let nextEl = section.nextElementSibling;
    while (nextEl && !nextEl.classList.contains('section-title')) {
      if (nextEl.classList.contains('control-group')) {
        const input = nextEl.querySelector('input[type="range"]');
        if (input && input.id) {
          const id = input.id;
          const stageForParam = STAGES.find(s => s.params.some(p => p.id === id));
          if (stageForParam) {
            paramsInGroup.push({
              id: id as keyof LogoParams,
              step: stageForParam.params.find(p => p.id === id)!.step
            });
          }
        }
      }
      nextEl = nextEl.nextElementSibling;
    }

    if (paramsInGroup.length > 0) {
      const btn = document.createElement('button');
      btn.className = 'opt-btn-small group-opt';
      btn.innerHTML = '⚡ Opt';
      btn.title = `Optimize all in ${sectionName}`;
      btn.addEventListener('click', () => {
        const stagesToRun = STAGES.map(s => {
          const matchingParams = s.params.filter(sp => paramsInGroup.some(pg => pg.id === sp.id));
          if (matchingParams.length > 0) {
            return {
              name: `${s.name} (${sectionName})`,
              maskKeys: s.maskKeys,
              params: matchingParams
            };
          }
          return null;
        }).filter(s => s !== null) as typeof STAGES;
        
        runOptimization(stagesToRun);
      });
      section.appendChild(btn);
    }
  });

  // Reference image for pixel diff
  const refInput = $('ref-image-input') as HTMLInputElement;
  refInput.addEventListener('change', () => {
    const file = refInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        referenceImage = await loadReferenceImage(reader.result as string);
        $('ref-status').textContent = `Loaded: ${file.name}`;
        update();
      } catch {
        $('ref-status').textContent = 'Error loading image';
      }
    };
    reader.readAsDataURL(file);
  });

  // Try to auto-load reference from the default path
  loadReferenceImage('../public/iliqchuan-white-bg.png').then(img => {
    referenceImage = img;
    $('ref-status').textContent = 'Loaded: iliqchuan-white-bg.png (auto)';
    update();
    // Auto-run optimizer on page load after reference is ready
    setTimeout(() => runOptimization(), 500);
  }).catch(() => {
    $('ref-status').textContent = 'No reference loaded (use file picker or serve via HTTP)';
  });

  // Try loading saved params
  const hasSaved = localStorage.getItem(STORAGE_KEY);
  if (hasSaved) {
    loadParams();
  }

  update();
}

// Start
init();
