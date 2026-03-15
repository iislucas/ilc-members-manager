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
  textBandWidth: number;
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
    textBandWidth: numVal('textBandWidth'),
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
    setInputVal('textBandWidth', p.textBandWidth);
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
function buildYinPath(cx: number, cy: number, R: number): string {
  const r = R / 2;
  const top = cy - R;
  const bottom = cy + R;
  const mid = cy;
  return [
    `M ${cx} ${top}`,
    `A ${R} ${R} 0 1 1 ${cx} ${bottom}`,
    `A ${r} ${r} 0 0 0 ${cx} ${mid}`,
    `A ${r} ${r} 0 0 1 ${cx} ${top}`,
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
  // Eyes
  if (p.yinYangEyeRadius > 0) {
    parts.push(`<circle cx="${cx}" cy="${cy - eyeOffset}" r="${p.yinYangEyeRadius}" fill="${p.fillLight}"/>`);
    parts.push(`<circle cx="${cx}" cy="${cy + eyeOffset}" r="${p.yinYangEyeRadius}" fill="${p.fillDark}"/>`);
  }
  // Border
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${p.strokeColor}" stroke-width="1.5"/>`);

  // Wrap in rotation group
  if (p.yinYangRotation !== 0) {
    return `<g transform="rotate(${p.yinYangRotation}, ${cx}, ${cy})">${parts.join('')}</g>`;
  }
  return parts.join('');
}

// Rings: inner border ring, outer border ring.
function buildRingsSvg(cx: number, cy: number, p: LogoParams): string {
  const innerR = p.yinYangRadius + p.innerRingWidth / 2;
  const outerR = p.yinYangRadius + p.innerRingWidth + p.textBandWidth + p.outerRingWidth / 2;
  const parts: string[] = [];
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${innerR}" fill="none" stroke="${p.strokeColor}" stroke-width="${p.innerRingWidth}"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerR}" fill="none" stroke="${p.strokeColor}" stroke-width="${p.outerRingWidth}"/>`);
  return parts.join('');
}

// Text along circular arcs using <textPath>.
function buildTextSvg(cx: number, cy: number, p: LogoParams): string {
  // The text band center radius
  const bandCenterR = p.yinYangRadius + p.innerRingWidth + p.textBandWidth / 2;
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

  // Chinese text (upper arc)
  parts.push(`<text font-size="${p.textSizeUpper}" fill="${p.strokeColor}" font-family="'Noto Serif SC', 'SimSun', serif" font-weight="700">`);
  parts.push(`  <textPath href="#upper-arc" startOffset="50%" text-anchor="middle">意 力 拳</textPath>`);
  parts.push(`</text>`);

  // Latin text (lower arc)
  parts.push(`<text font-size="${p.textSizeLower}" fill="${p.strokeColor}" font-family="'Times New Roman', 'Noto Serif', serif" font-weight="700" letter-spacing="${p.textLetterSpacingLower}">`);
  parts.push(`  <textPath href="#lower-arc" startOffset="50%" text-anchor="middle">I  LIQ  CHUAN</textPath>`);
  parts.push(`</text>`);

  return parts.join('\n');
}

// 8 spokes radiating from the outer ring.
function buildSpokesSvg(cx: number, cy: number, p: LogoParams): string {
  const outerRingOuterEdge = p.yinYangRadius + p.innerRingWidth + p.textBandWidth + p.outerRingWidth;
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
// Cardinal (N,E,S,W) - larger concave "petal" shape
// Diagonal (NE,SE,SW,NW) - smaller simple diamond
function buildTipsSvg(cx: number, cy: number, p: LogoParams): string {
  const outerRingOuterEdge = p.yinYangRadius + p.innerRingWidth + p.textBandWidth + p.outerRingWidth;
  const tipStart = outerRingOuterEdge + p.spokeLength;
  const parts: string[] = [];

  for (let i = 0; i < 8; i++) {
    const angleDeg = i * 45;
    const angle = angleDeg * Math.PI / 180;
    const isCardinal = angleDeg % 90 === 0;

    const tipLen = isCardinal ? p.cardinalTipLength : p.diagonalTipLength;
    const tipW = isCardinal ? p.cardinalTipWidth : p.diagonalTipWidth;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const perpCos = Math.cos(angle + Math.PI / 2);
    const perpSin = Math.sin(angle + Math.PI / 2);

    // Tip center point
    const tipCenterR = tipStart + tipLen / 2;
    // Diamond: 4 points - inner, left, outer, right
    const innerX = cx + tipStart * cos;
    const innerY = cy + tipStart * sin;
    const outerX = cx + (tipStart + tipLen) * cos;
    const outerY = cy + (tipStart + tipLen) * sin;
    const leftX = cx + tipCenterR * cos - tipW * perpCos;
    const leftY = cy + tipCenterR * sin - tipW * perpSin;
    const rightX = cx + tipCenterR * cos + tipW * perpCos;
    const rightY = cy + tipCenterR * sin + tipW * perpSin;

    if (isCardinal) {
      // Cardinal tips: concave sides (pinched petal shape).
      // Use quadratic bezier curves with control points pulled inward.
      const pullFactor = 0.35;
      // Control points for concave sides (pulled toward center axis)
      const cInnerLeftX = cx + (tipStart + tipLen * pullFactor) * cos - tipW * 0.3 * perpCos;
      const cInnerLeftY = cy + (tipStart + tipLen * pullFactor) * sin - tipW * 0.3 * perpSin;
      const cOuterLeftX = cx + (tipStart + tipLen * (1 - pullFactor)) * cos - tipW * 0.3 * perpCos;
      const cOuterLeftY = cy + (tipStart + tipLen * (1 - pullFactor)) * sin - tipW * 0.3 * perpSin;
      const cInnerRightX = cx + (tipStart + tipLen * pullFactor) * cos + tipW * 0.3 * perpCos;
      const cInnerRightY = cy + (tipStart + tipLen * pullFactor) * sin + tipW * 0.3 * perpSin;
      const cOuterRightX = cx + (tipStart + tipLen * (1 - pullFactor)) * cos + tipW * 0.3 * perpCos;
      const cOuterRightY = cy + (tipStart + tipLen * (1 - pullFactor)) * sin + tipW * 0.3 * perpSin;

      parts.push(`<path d="M ${innerX} ${innerY} Q ${cInnerLeftX} ${cInnerLeftY} ${leftX} ${leftY} Q ${cOuterLeftX} ${cOuterLeftY} ${outerX} ${outerY} Q ${cOuterRightX} ${cOuterRightY} ${rightX} ${rightY} Q ${cInnerRightX} ${cInnerRightY} ${innerX} ${innerY} Z" fill="${p.strokeColor}"/>`);
    } else {
      // Diagonal tips: simple diamond
      parts.push(`<polygon points="${innerX},${innerY} ${leftX},${leftY} ${outerX},${outerY} ${rightX},${rightY}" fill="${p.strokeColor}"/>`);
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Full SVG assembly
// ---------------------------------------------------------------------------

function computeViewSize(p: LogoParams): number {
  const outerEdge = p.yinYangRadius + p.innerRingWidth + p.textBandWidth + p.outerRingWidth;
  const fullR = outerEdge + p.spokeLength + Math.max(p.cardinalTipLength, p.diagonalTipLength);
  return Math.ceil(fullR * 2 + 20); // 10px padding each side
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

async function updateDiff(p: LogoParams): Promise<void> {
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

  // Draw reference
  const refCtx = refCanvas.getContext('2d')!;
  refCtx.fillStyle = '#ffffff';
  refCtx.fillRect(0, 0, diffSize, diffSize);
  refCtx.drawImage(referenceImage, 0, 0, diffSize, diffSize);

  // Draw generated SVG
  const genCtx = genCanvas.getContext('2d')!;
  genCtx.fillStyle = '#ffffff';
  genCtx.fillRect(0, 0, diffSize, diffSize);

  const svgStr = buildFullSvg({ ...p, transparentBg: false, bgColor: '#ffffff' });
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const svgImg = await loadReferenceImage(url);
  genCtx.drawImage(svgImg, 0, 0, diffSize, diffSize);
  URL.revokeObjectURL(url);

  // Compute diff
  const refData = refCtx.getImageData(0, 0, diffSize, diffSize).data;
  const genData = genCtx.getImageData(0, 0, diffSize, diffSize).data;
  const diffCtx = diffCanvas.getContext('2d')!;
  const diffImgData = diffCtx.createImageData(diffSize, diffSize);
  const diffData = diffImgData.data;

  let sumSqErr = 0;
  const totalPixels = diffSize * diffSize;

  for (let i = 0; i < refData.length; i += 4) {
    const dr = Math.abs(refData[i] - genData[i]);
    const dg = Math.abs(refData[i + 1] - genData[i + 1]);
    const db = Math.abs(refData[i + 2] - genData[i + 2]);
    const diff = (dr + dg + db) / 3;

    sumSqErr += diff * diff;

    // Heatmap: transparent where close, red where different
    diffData[i] = 255; // R
    diffData[i + 1] = 0; // G
    diffData[i + 2] = 0; // B
    diffData[i + 3] = Math.min(255, diff * 3); // A — amplified for visibility
  }

  diffCtx.putImageData(diffImgData, 0, 0);

  const rmse = Math.sqrt(sumSqErr / totalPixels);
  $('rmse-score').textContent = rmse.toFixed(2);
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
  $('textBandWidth-val').textContent = String(p.textBandWidth);
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
    'innerRingWidth', 'textBandWidth', 'outerRingWidth',
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
