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
// DOM helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function numVal(id) {
    return parseFloat($(id).value);
}
function strVal(id) {
    return $(id).value;
}
function boolVal(id) {
    return $(id).checked;
}
// ---------------------------------------------------------------------------
// Parameter read / write
// ---------------------------------------------------------------------------
function getParams() {
    return {
        yinYangRadius: numVal('yinYangRadius'),
        yinYangEyeRadius: numVal('yinYangEyeRadius'),
        yinYangEyePosition: numVal('yinYangEyePosition') / 100,
        yinYangRotation: numVal('yinYangRotation'),
        yinYangGap: numVal('yinYangGap'),
        innerRingWidth: numVal('innerRingWidth'),
        innerRingGap: numVal('innerRingGap'),
        textBandWidth: numVal('textBandWidth'),
        scallopRadius: numVal('scallopRadius'),
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
function saveParams() {
    const p = getParams();
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
        const btn = $('save-btn');
        btn.textContent = '✓ Saved!';
        setTimeout(() => (btn.textContent = 'Save Parameters'), 1500);
    }
    catch {
        // ignore
    }
}
function loadParams() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return;
        const p = JSON.parse(raw);
        setInputVal('yinYangRadius', p.yinYangRadius);
        setInputVal('yinYangEyeRadius', p.yinYangEyeRadius);
        setInputVal('yinYangEyePosition', p.yinYangEyePosition * 100);
        setInputVal('yinYangRotation', p.yinYangRotation);
        setInputVal('yinYangGap', p.yinYangGap ?? 2);
        setInputVal('innerRingWidth', p.innerRingWidth);
        setInputVal('innerRingGap', p.innerRingGap ?? 4);
        setInputVal('textBandWidth', p.textBandWidth);
        setInputVal('scallopRadius', p.scallopRadius ?? 4);
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
        $('transparentBg').checked = p.transparentBg;
        update();
    }
    catch {
        // ignore
    }
}
function setInputVal(id, val) {
    const el = $(id);
    if (el)
        el.value = String(val);
}
// ---------------------------------------------------------------------------
// SVG geometry builders
// ---------------------------------------------------------------------------
// Yin-yang S-curve path (dark half).
// sweep-flag=0 makes the dark half bulge LEFT (matching the reference image).
// Path starts from BOTTOM, arcs to TOP — flipped on x-axis.
function buildYinPath(cx, cy, R) {
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
function buildYinYangSvg(cx, cy, p) {
    const R = p.yinYangRadius;
    const eyeOffset = R * p.yinYangEyePosition;
    const yinPath = buildYinPath(cx, cy, R);
    const parts = [];
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
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${p.strokeColor}" stroke-width="1.5"/>`);
    // Wrap in rotation group
    if (p.yinYangRotation !== 0) {
        return `<g transform="rotate(${p.yinYangRotation}, ${cx}, ${cy})">${parts.join('')}</g>`;
    }
    return parts.join('');
}
// Rings: dark filled text band annulus + border rings + scalloped inner edge.
function buildRingsSvg(cx, cy, p) {
    const innerRingCenterR = p.yinYangRadius + p.yinYangGap + p.innerRingWidth / 2;
    const bandInnerR = p.yinYangRadius + p.yinYangGap + p.innerRingWidth + p.innerRingGap;
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
    const parts = [];
    // Filled dark annulus for text band background
    parts.push(`<path d="${annulusPath}" fill="${p.fillDark}" fill-rule="evenodd"/>`);
    // Scalloped / cloud-border decoration at the inner ring edge.
    // We draw white circles to cut wavy bites out of the dark text band.
    const scallops = 24;
    const scallopR = p.scallopRadius; // bump radius
    const scallopBaseR = bandInnerR; // on the inner edge of text band
    for (let i = 0; i < scallops; i++) {
        const a = (i / scallops) * Math.PI * 2;
        const bx = cx + scallopBaseR * Math.cos(a);
        const by = cy + scallopBaseR * Math.sin(a);
        parts.push(`<circle cx="${bx}" cy="${by}" r="${scallopR}" fill="${p.fillLight}" stroke="none"/>`);
    }
    // Inner border ring
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${innerRingCenterR}" fill="none" stroke="${p.strokeColor}" stroke-width="${p.innerRingWidth}"/>`);
    // Outer border ring
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${outerRingCenterR}" fill="none" stroke="${p.strokeColor}" stroke-width="${p.outerRingWidth}"/>`);
    return parts.join('');
}
// Text along circular arcs using <textPath>.
function buildTextSvg(cx, cy, p) {
    // The text band center radius
    const bandInnerR = p.yinYangRadius + p.yinYangGap + p.innerRingWidth + p.innerRingGap;
    const bandCenterR = bandInnerR + p.textBandWidth / 2;
    const parts = [];
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
function buildSpokesSvg(cx, cy, p) {
    const outerRingOuterEdge = p.yinYangRadius + p.yinYangGap + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
    const parts = [];
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
function buildTipsSvg(cx, cy, p) {
    const outerRingOuterEdge = p.yinYangRadius + p.yinYangGap + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
    const tipStart = outerRingOuterEdge + p.spokeLength;
    const parts = [];
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
        if (isCardinal) {
            // Vajra/scepter shape — 10 profile points along the spoke axis.
            // Distances are fractions of tipLen from tipStart:
            //   0.0  = base (meets spoke)
            //   0.15 = shoulder widest point (lobe)
            //   0.30 = waist (pinch inward)
            //   0.50 = mid-lobe second bulge (smaller)
            //   0.70 = narrowing toward tip
            //   1.0  = pointed tip
            const pt = (frac, perpW) => {
                const r = tipStart + tipLen * frac;
                return {
                    lx: cx + r * cos - perpW * perpCos,
                    ly: cy + r * sin - perpW * perpSin,
                    rx: cx + r * cos + perpW * perpCos,
                    ry: cy + r * sin + perpW * perpSin,
                };
            };
            const base = pt(0, tipW * 0.25); // narrow base at spoke junction
            const shoulder = pt(0.18, tipW * 1.0); // widest lobe
            const waist = pt(0.38, tipW * 0.3); // pinched waist
            const midLobe = pt(0.55, tipW * 0.6); // secondary bulge
            const narrow = pt(0.75, tipW * 0.2); // narrowing
            const tipPt = {
                x: cx + (tipStart + tipLen) * cos,
                y: cy + (tipStart + tipLen) * sin,
            };
            // Build path: left side from base to tip, then right side back
            parts.push(`<path d="
        M ${base.lx} ${base.ly}
        Q ${cx + (tipStart + tipLen * 0.05) * cos - tipW * 0.7 * perpCos} ${cy + (tipStart + tipLen * 0.05) * sin - tipW * 0.7 * perpSin} ${shoulder.lx} ${shoulder.ly}
        Q ${cx + (tipStart + tipLen * 0.28) * cos - tipW * 0.7 * perpCos} ${cy + (tipStart + tipLen * 0.28) * sin - tipW * 0.7 * perpSin} ${waist.lx} ${waist.ly}
        Q ${cx + (tipStart + tipLen * 0.45) * cos - tipW * 0.55 * perpCos} ${cy + (tipStart + tipLen * 0.45) * sin - tipW * 0.55 * perpSin} ${midLobe.lx} ${midLobe.ly}
        Q ${cx + (tipStart + tipLen * 0.65) * cos - tipW * 0.35 * perpCos} ${cy + (tipStart + tipLen * 0.65) * sin - tipW * 0.35 * perpSin} ${narrow.lx} ${narrow.ly}
        L ${tipPt.x} ${tipPt.y}
        L ${narrow.rx} ${narrow.ry}
        Q ${cx + (tipStart + tipLen * 0.65) * cos + tipW * 0.35 * perpCos} ${cy + (tipStart + tipLen * 0.65) * sin + tipW * 0.35 * perpSin} ${midLobe.rx} ${midLobe.ry}
        Q ${cx + (tipStart + tipLen * 0.45) * cos + tipW * 0.55 * perpCos} ${cy + (tipStart + tipLen * 0.45) * sin + tipW * 0.55 * perpSin} ${waist.rx} ${waist.ry}
        Q ${cx + (tipStart + tipLen * 0.28) * cos + tipW * 0.7 * perpCos} ${cy + (tipStart + tipLen * 0.28) * sin + tipW * 0.7 * perpSin} ${shoulder.rx} ${shoulder.ry}
        Q ${cx + (tipStart + tipLen * 0.05) * cos + tipW * 0.7 * perpCos} ${cy + (tipStart + tipLen * 0.05) * sin + tipW * 0.7 * perpSin} ${base.rx} ${base.ry}
        Z
      " fill="${p.strokeColor}"/>`);
        }
        else {
            // Diagonal tips: simple diamond
            const tipCenterR = tipStart + tipLen / 2;
            const innerX = cx + tipStart * cos;
            const innerY = cy + tipStart * sin;
            const outerX = cx + (tipStart + tipLen) * cos;
            const outerY = cy + (tipStart + tipLen) * sin;
            const leftX = cx + tipCenterR * cos - tipW * perpCos;
            const leftY = cy + tipCenterR * sin - tipW * perpSin;
            const rightX = cx + tipCenterR * cos + tipW * perpCos;
            const rightY = cy + tipCenterR * sin + tipW * perpSin;
            parts.push(`<polygon points="${innerX},${innerY} ${leftX},${leftY} ${outerX},${outerY} ${rightX},${rightY}" fill="${p.strokeColor}"/>`);
        }
    }
    return parts.join('\n');
}
// ---------------------------------------------------------------------------
// Full SVG assembly
// ---------------------------------------------------------------------------
function computeViewSize(p) {
    const outerEdge = p.yinYangRadius + p.yinYangGap + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
    const fullR = outerEdge + p.spokeLength + Math.max(p.cardinalTipLength, p.diagonalTipLength);
    return Math.ceil(fullR * 2 + 20); // 10px padding each side
}
function buildFullSvg(p, size) {
    const viewSize = size || computeViewSize(p);
    const cx = viewSize / 2;
    const cy = viewSize / 2;
    const parts = [];
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
let referenceImage = null;
function loadReferenceImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
async function updateDiff(p) {
    if (!referenceImage)
        return;
    const diffSize = 400;
    const refCanvas = $('ref-canvas');
    const genCanvas = $('gen-canvas');
    const diffCanvas = $('diff-canvas');
    refCanvas.width = diffSize;
    refCanvas.height = diffSize;
    genCanvas.width = diffSize;
    genCanvas.height = diffSize;
    diffCanvas.width = diffSize;
    diffCanvas.height = diffSize;
    // Draw reference on transparent canvas (no white fill)
    const refCtx = refCanvas.getContext('2d');
    refCtx.clearRect(0, 0, diffSize, diffSize);
    refCtx.drawImage(referenceImage, 0, 0, diffSize, diffSize);
    // Draw generated SVG with transparent background
    const genCtx = genCanvas.getContext('2d');
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
    refWhite.width = diffSize;
    refWhite.height = diffSize;
    const refWhiteCtx = refWhite.getContext('2d');
    refWhiteCtx.fillStyle = '#ffffff';
    refWhiteCtx.fillRect(0, 0, diffSize, diffSize);
    refWhiteCtx.drawImage(referenceImage, 0, 0, diffSize, diffSize);
    const genWhite = document.createElement('canvas');
    genWhite.width = diffSize;
    genWhite.height = diffSize;
    const genWhiteCtx = genWhite.getContext('2d');
    genWhiteCtx.fillStyle = '#ffffff';
    genWhiteCtx.fillRect(0, 0, diffSize, diffSize);
    genWhiteCtx.drawImage(svgImg, 0, 0, diffSize, diffSize);
    // Get pixel data
    const refData = refWhiteCtx.getImageData(0, 0, diffSize, diffSize).data;
    const genData = genWhiteCtx.getImageData(0, 0, diffSize, diffSize).data;
    const refRawData = refCtx.getImageData(0, 0, diffSize, diffSize).data;
    const genRawData = genCtx.getImageData(0, 0, diffSize, diffSize).data;
    const diffCtx = diffCanvas.getContext('2d');
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
        diffData[i] = 255; // R
        diffData[i + 1] = 0; // G
        diffData[i + 2] = 0; // B
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
async function computeRMSEFast(p) {
    if (!referenceImage)
        return { color: Infinity, alpha: Infinity };
    const size = 200; // smaller for speed during optimization
    const offRef = document.createElement('canvas');
    offRef.width = size;
    offRef.height = size;
    const offGen = document.createElement('canvas');
    offGen.width = size;
    offGen.height = size;
    // Composite reference on white
    const refCtx = offRef.getContext('2d');
    refCtx.fillStyle = '#ffffff';
    refCtx.fillRect(0, 0, size, size);
    refCtx.drawImage(referenceImage, 0, 0, size, size);
    // Render generated on white
    const genCtx = offGen.getContext('2d');
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
    const totalPixels = size * size;
    let sumSqColor = 0;
    let sumSqAlpha = 0;
    for (let i = 0; i < refData.length; i += 4) {
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
    return {
        color: Math.sqrt(sumSqColor / totalPixels),
        alpha: Math.sqrt(sumSqAlpha / totalPixels),
    };
}
// ---------------------------------------------------------------------------
// Hill-climbing optimizer (coordinate descent)
// ---------------------------------------------------------------------------
// Numeric slider IDs eligible for auto-optimization.
// User-only params (excluded from optimization):
//   - yinYangRotation: dots must stay vertically aligned
//   - colors (strokeColor, fillLight, fillDark, bgColor): structural, not tunable
//   - transparentBg: boolean, not numeric
const OPTIMIZABLE_PARAMS = [
    { id: 'yinYangRadius', step: 1 },
    { id: 'yinYangEyeRadius', step: 1 },
    { id: 'yinYangEyePosition', step: 1 },
    // yinYangRotation deliberately excluded — user-only
    { id: 'yinYangGap', step: 0.5 },
    { id: 'innerRingWidth', step: 0.5 },
    { id: 'innerRingGap', step: 0.5 },
    { id: 'textBandWidth', step: 1 },
    { id: 'scallopRadius', step: 0.5 },
    { id: 'outerRingGap', step: 0.5 },
    { id: 'outerRingWidth', step: 0.5 },
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
];
let optimizing = false;
async function runOptimization() {
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
    let baseRMSE = await computeRMSEFast(getParams());
    let combined = baseRMSE.color + baseRMSE.alpha;
    statusEl.textContent = `Starting: ${combined.toFixed(2)}`;
    const maxPasses = 10;
    for (let pass = 0; pass < maxPasses && optimizing; pass++) {
        let improved = false;
        for (const param of OPTIMIZABLE_PARAMS) {
            if (!optimizing)
                break;
            const el = $(param.id);
            const min = parseFloat(el.min);
            const max = parseFloat(el.max);
            const current = parseFloat(el.value);
            let bestVal = current;
            let bestCombined = combined;
            // Try stepping up
            const upVal = Math.min(max, current + param.step);
            if (upVal !== current) {
                el.value = String(upVal);
                const upRMSE = await computeRMSEFast(getParams());
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
                const downRMSE = await computeRMSEFast(getParams());
                const downCombined = downRMSE.color + downRMSE.alpha;
                if (downCombined < bestCombined) {
                    bestVal = downVal;
                    bestCombined = downCombined;
                }
            }
            // Apply best
            el.value = String(bestVal);
            if (bestVal !== current) {
                combined = bestCombined;
                improved = true;
            }
            statusEl.textContent = `Pass ${pass + 1}/${maxPasses} | ${param.id}: ${bestVal} | RMSE: ${combined.toFixed(2)}`;
            // Yield to browser for UI updates
            await new Promise(r => setTimeout(r, 0));
        }
        // Full visual update after each pass
        update();
        await new Promise(r => setTimeout(r, 50));
        if (!improved) {
            statusEl.textContent = `Converged after ${pass + 1} passes! RMSE: ${combined.toFixed(2)}`;
            break;
        }
    }
    optimizing = false;
    btn.textContent = '⚡ Optimize';
    update(); // Final visual update with best values
}
// ---------------------------------------------------------------------------
// PNG export
// ---------------------------------------------------------------------------
function downloadPng(targetSize) {
    const p = getParams();
    const svgStr = buildFullSvg(p);
    const canvas = $('export-canvas');
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
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
function updateLabels(p) {
    $('yinYangRadius-val').textContent = String(p.yinYangRadius);
    $('yinYangEyeRadius-val').textContent = String(p.yinYangEyeRadius);
    $('yinYangEyePosition-val').textContent = (p.yinYangEyePosition * 100).toFixed(0) + '%';
    $('yinYangRotation-val').textContent = p.yinYangRotation + '°';
    $('yinYangGap-val').textContent = String(p.yinYangGap);
    $('innerRingWidth-val').textContent = String(p.innerRingWidth);
    $('innerRingGap-val').textContent = String(p.innerRingGap);
    $('textBandWidth-val').textContent = String(p.textBandWidth);
    $('scallopRadius-val').textContent = String(p.scallopRadius);
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
function update() {
    const p = getParams();
    updateLabels(p);
    const viewSize = computeViewSize(p);
    // Build preview SVG
    const previewSvg = $('main-preview');
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
    }
    else {
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
    $('svg-output').value = fullSvg;
    // Update diff
    updateDiff(p);
}
// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
function init() {
    // Wire up all range/color inputs
    const controlIds = [
        'yinYangRadius', 'yinYangEyeRadius', 'yinYangEyePosition', 'yinYangRotation',
        'yinYangGap', 'innerRingWidth', 'innerRingGap', 'textBandWidth', 'scallopRadius', 'outerRingGap', 'outerRingWidth',
        'textSizeUpper', 'textSizeLower', 'textOffsetUpper', 'textOffsetLower', 'textLetterSpacingLower',
        'spokeLength', 'spokeWidth',
        'cardinalTipLength', 'cardinalTipWidth', 'diagonalTipLength', 'diagonalTipWidth',
        'strokeColor', 'fillLight', 'fillDark', 'bgColor',
    ];
    for (const id of controlIds) {
        const el = $(id);
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
        const text = $('svg-output').value;
        navigator.clipboard.writeText(text).then(() => {
            $('copy-svg-btn').textContent = '✓ Copied!';
            setTimeout(() => ($('copy-svg-btn').textContent = 'Copy SVG'), 1500);
        });
    });
    // PNG downloads
    $('download-png-192').addEventListener('click', () => downloadPng(192));
    $('download-png-512').addEventListener('click', () => downloadPng(512));
    // Optimize button
    $('opt-btn').addEventListener('click', runOptimization);
    // Reference image for pixel diff
    const refInput = $('ref-image-input');
    refInput.addEventListener('change', () => {
        const file = refInput.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                referenceImage = await loadReferenceImage(reader.result);
                $('ref-status').textContent = `Loaded: ${file.name}`;
                update();
            }
            catch {
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
