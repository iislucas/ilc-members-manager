/* Logo Maker – SVG geometry builders.
 *
 * Pure functions that generate SVG markup strings for each layer of the logo:
 * yin-yang, rings, text arcs, spokes, ornamental tips, and full SVG assembly.
 */
import { DEFAULT_CHARACTERS, normalizeCharacterModel, sanitizeHexColor, } from './glyph-maker/defaults.js';
import { buildCharacterPaths } from './glyph-maker/stroke-svg.js';
import { GlyphId, VIEWBOX_SIZE } from './glyph-maker/types.js';
const GLYPH_STORAGE_PREFIX = 'ilc-chinese-glyph-v1-';
const glyphPathCache = new Map();
function getChineseGlyphPaths(gid) {
    let rawJson = null;
    try {
        if (typeof localStorage !== 'undefined') {
            rawJson = localStorage.getItem(GLYPH_STORAGE_PREFIX + gid);
        }
    }
    catch {
        rawJson = null;
    }
    const cached = glyphPathCache.get(gid);
    if (cached && cached.rawJson === rawJson) {
        return cached.paths;
    }
    const fallback = DEFAULT_CHARACTERS[gid];
    let model = fallback;
    if (rawJson) {
        try {
            model = normalizeCharacterModel(JSON.parse(rawJson), fallback);
        }
        catch {
            model = fallback;
        }
    }
    const paths = buildCharacterPaths(model);
    glyphPathCache.set(gid, { rawJson, paths });
    return paths;
}
// ---------------------------------------------------------------------------
// Yin-yang
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
export function buildYinYangSvg(cx, cy, p) {
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
export function buildRingsSvg(cx, cy, p) {
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
    const parts = [];
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
// Upper Chinese vector calligraphic glyphs (意 力 拳) + lower Latin <textPath>.
export function buildTextSvg(cx, cy, p) {
    const yinYangBorderWidth = 1.5;
    const yinYangOuterR = p.yinYangRadius + yinYangBorderWidth / 2;
    const bandInnerR = yinYangOuterR + p.innerRingWidth + p.innerRingGap;
    const bandCenterR = bandInnerR + p.textBandWidth / 2;
    const fillLight = sanitizeHexColor(p.fillLight, '#ffffff');
    const parts = [];
    // Place the three 200x200 calligraphic vector SVGs along the upper arc.
    // Intrinsic radial trims (+1.25, -1.15, -0.10 at size 61.8) preserve the optical
    // baseline of each extracted character bounding box.
    const baseR = bandCenterR + p.chineseRadialOffset;
    const glyphScale = p.chineseGlyphSize / VIEWBOX_SIZE;
    const trimScale = p.chineseGlyphSize / 61.8;
    const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
    const placements = [
        {
            id: GlyphId.Yi,
            comment: '意 (Yi)',
            r: baseR + 1.25 * trimScale,
            angleDeg: -p.chineseSpreadAngle,
            rotDeg: -p.chineseTiltAngle,
        },
        {
            id: GlyphId.Li,
            comment: '力 (Li)',
            r: baseR - 1.15 * trimScale,
            angleDeg: 0,
            rotDeg: 0,
        },
        {
            id: GlyphId.Quan,
            comment: '拳 (Quan)',
            r: baseR - 0.1 * trimScale,
            angleDeg: p.chineseSpreadAngle,
            rotDeg: p.chineseTiltAngle,
        },
    ];
    parts.push(`<g id="chinese-glyphs" fill="${fillLight}">`);
    for (const item of placements) {
        const rad = (item.angleDeg * Math.PI) / 180;
        const gx = cx + item.r * Math.sin(rad);
        const gy = cy - item.r * Math.cos(rad);
        const paths = getChineseGlyphPaths(item.id);
        parts.push(`  <!-- ${item.comment} -->`);
        parts.push(`  <g transform="translate(${fmt(gx)}, ${fmt(gy)}) rotate(${fmt(item.rotDeg)}) scale(${fmt(glyphScale)}) translate(-100, -100)">`);
        for (const d of paths) {
            if (d) {
                parts.push(`    <path d="${d}"/>`);
            }
        }
        parts.push('  </g>');
    }
    parts.push('</g>');
    // Lower arc for "I", "LIQ", "CHUAN" with independent per-letter arc offsets.
    const lowerR = bandCenterR + p.textOffsetLower;
    const arcLen = Math.PI * lowerR;
    const fs = p.textSizeLower;
    const ls = p.textLetterSpacingLower;
    const gap = p.textWordSpacingLower;
    // Exact Times New Roman 700 single-glyph advance width coefficients along #lower-arc
    const wordDefs = [
        [{ ch: 'I', wCoeff: 0.3893, offsetDeg: p.letterOffsetI1 }],
        [
            { ch: 'L', wCoeff: 0.667, offsetDeg: p.letterOffsetL },
            { ch: 'I', wCoeff: 0.3893, offsetDeg: p.letterOffsetI2 },
            { ch: 'Q', wCoeff: 0.7783, offsetDeg: p.letterOffsetQ },
        ],
        [
            { ch: 'C', wCoeff: 0.7222, offsetDeg: p.letterOffsetC },
            { ch: 'H', wCoeff: 0.7783, offsetDeg: p.letterOffsetH },
            { ch: 'U', wCoeff: 0.7222, offsetDeg: p.letterOffsetU },
            { ch: 'A', wCoeff: 0.7222, offsetDeg: p.letterOffsetA },
            { ch: 'N', wCoeff: 0.7222, offsetDeg: p.letterOffsetN },
        ],
    ];
    let totalSpan = 0;
    for (let wIdx = 0; wIdx < wordDefs.length; wIdx++) {
        if (wIdx > 0)
            totalSpan += gap;
        const word = wordDefs[wIdx];
        for (let k = 0; k < word.length; k++) {
            if (k > 0)
                totalSpan += ls;
            totalSpan += word[k].wCoeff * fs;
        }
    }
    let cursorX = (arcLen - totalSpan) / 2;
    const letterPlacements = [];
    for (let wIdx = 0; wIdx < wordDefs.length; wIdx++) {
        if (wIdx > 0)
            cursorX += gap;
        const word = wordDefs[wIdx];
        for (let k = 0; k < word.length; k++) {
            if (k > 0)
                cursorX += ls;
            const w = word[k].wCoeff * fs;
            const centerArcX = cursorX + w / 2;
            const pct = (centerArcX / arcLen) * 100 + (word[k].offsetDeg / 180) * 100;
            letterPlacements.push({ ch: word[k].ch, pct });
            cursorX += w;
        }
    }
    parts.push('<defs>');
    parts.push(`  <path id="lower-arc" d="M ${fmt(cx - lowerR)} ${cy} A ${fmt(lowerR)} ${fmt(lowerR)} 0 1 0 ${fmt(cx + lowerR)} ${cy}" fill="none"/>`);
    parts.push('</defs>');
    parts.push(`<g id="latin-words" font-size="${fs}" fill="${fillLight}" font-family="${p.fontFamilyLatin}" font-weight="700">`);
    for (const item of letterPlacements) {
        parts.push(`  <text><textPath href="#lower-arc" startOffset="${fmt(item.pct)}%" text-anchor="middle">${item.ch}</textPath></text>`);
    }
    parts.push('</g>');
    return parts.join('\n');
}
// ---------------------------------------------------------------------------
// Merged Outer Base (Venn Technique)
// ---------------------------------------------------------------------------
// Replaces the solid background circle, outer border ring, spokes, and tips.
// Draws them all as a single united shape using the Two-Pass Silhouette pattern.
export function buildMergedOuterBaseSvg(cx, cy, p) {
    const yinYangBorderWidth = 1.5;
    const outerRingInnerEdge = p.yinYangRadius +
        yinYangBorderWidth / 2 +
        p.innerRingWidth +
        p.innerRingGap +
        p.textBandWidth +
        p.outerRingGap;
    const outerRingOuterEdge = outerRingInnerEdge + p.outerRingWidth;
    const fmt = (n) => (Math.round(n * 1000) / 1000).toString();
    const roundShapes = [];
    const miterCardinalSpikes = [];
    const fallbackSolidSpikes = [];
    // 1. The outer circle (extends to the inner edge of the outer ring stroke)
    roundShapes.push(`<circle cx="${cx}" cy="${cy}" r="${fmt(outerRingInnerEdge)}"/>`);
    for (let i = 0; i < 8; i++) {
        const angleDeg = i * 45;
        const angle = (angleDeg * Math.PI) / 180;
        const isCardinal = angleDeg % 90 === 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const perpCos = Math.cos(angle + Math.PI / 2);
        const perpSin = Math.sin(angle + Math.PI / 2);
        // 2. Decorations
        const tipStart = outerRingOuterEdge +
            (isCardinal ? p.nsewDecorationDistance : p.diagonalDecorationDistance);
        const tipW = isCardinal ? p.nsewDecorationWidth : p.diagonalDecorationWidth;
        if (tipW > 0) {
            if (isCardinal) {
                const tipLen = p.nsewDecorationLength;
                if (tipLen <= 0)
                    continue;
                const halfW = tipW / 2;
                const baseR = tipStart;
                const tipR = Math.min(cx - 0.25, tipStart + tipLen);
                const bumpR = tipW * 0.315;
                const sharp = p.nsewDecorationConcavity;
                // Narrow mitered spike: stroked with stroke-linejoin="miter" in Pass 1 and filled
                // with fillLight in Pass 2 so ONLY the outer outerRingWidth pixels are black and
                // the miter apex lands cleanly at tipR.
                const taper = Math.max(0.03, 1 - sharp * 0.09);
                const sinAlpha = 0.065 + 0.34 * taper;
                const tanAlpha = sinAlpha / Math.sqrt(Math.max(0.01, 1 - sinAlpha * sinAlpha));
                const anchorR = p.nsewDecorationThirdBumpRadius > 0
                    ? tipStart + p.nsewDecorationThirdBumpDistance
                    : baseR;
                const rApexIn = tipR - p.outerRingWidth / sinAlpha;
                if (rApexIn > anchorR + 0.5) {
                    const wAnchorIn = (rApexIn - anchorR) * tanAlpha;
                    const bx1 = cx + anchorR * cos - wAnchorIn * perpCos;
                    const by1 = cy + anchorR * sin - wAnchorIn * perpSin;
                    const bx2 = cx + anchorR * cos + wAnchorIn * perpCos;
                    const by2 = cy + anchorR * sin + wAnchorIn * perpSin;
                    const ax = cx + rApexIn * cos;
                    const ay = cy + rApexIn * sin;
                    miterCardinalSpikes.push(`<polygon points="${fmt(bx1)},${fmt(by1)} ${fmt(ax)},${fmt(ay)} ${fmt(bx2)},${fmt(by2)}"/>`);
                }
                else if (tipR > anchorR + 0.5) {
                    const wAnchorOut = (tipR - anchorR) * tanAlpha;
                    const bx1 = cx + anchorR * cos - wAnchorOut * perpCos;
                    const by1 = cy + anchorR * sin - wAnchorOut * perpSin;
                    const bx2 = cx + anchorR * cos + wAnchorOut * perpCos;
                    const by2 = cy + anchorR * sin + wAnchorOut * perpSin;
                    const tx = cx + tipR * cos;
                    const ty = cy + tipR * sin;
                    fallbackSolidSpikes.push(`<polygon points="${fmt(bx1)},${fmt(by1)} ${fmt(tx)},${fmt(ty)} ${fmt(bx2)},${fmt(by2)}"/>`);
                }
                // Side Bumps
                const leftBumpX = cx + baseR * cos - (halfW - bumpR) * perpCos;
                const leftBumpY = cy + baseR * sin - (halfW - bumpR) * perpSin;
                const rightBumpX = cx + baseR * cos + (halfW - bumpR) * perpCos;
                const rightBumpY = cy + baseR * sin + (halfW - bumpR) * perpSin;
                roundShapes.push(`<circle cx="${fmt(leftBumpX)}" cy="${fmt(leftBumpY)}" r="${fmt(bumpR)}"/>`);
                roundShapes.push(`<circle cx="${fmt(rightBumpX)}" cy="${fmt(rightBumpY)}" r="${fmt(bumpR)}"/>`);
                // Third Bump (Center base)
                if (p.nsewDecorationThirdBumpRadius > 0) {
                    const bumpDist = tipStart + p.nsewDecorationThirdBumpDistance;
                    const thirdBumpX = cx + bumpDist * cos;
                    const thirdBumpY = cy + bumpDist * sin;
                    roundShapes.push('<!-- Third central bump -->');
                    roundShapes.push(`<circle cx="${fmt(thirdBumpX)}" cy="${fmt(thirdBumpY)}" r="${fmt(p.nsewDecorationThirdBumpRadius)}"/>`);
                    // Narrow bridging rect up to baseR to prevent interior gap lines while
                    // preserving the circular waist and base cusps of the 3-lobe trefoil.
                    const rectHalfW = Math.min(p.nsewDecorationThirdBumpRadius * 0.65, halfW * 0.35);
                    const baseX = cx + baseR * cos;
                    const baseY = cy + baseR * sin;
                    const rx1 = cx - rectHalfW * perpCos;
                    const ry1 = cy - rectHalfW * perpSin;
                    const rx2 = cx + rectHalfW * perpCos;
                    const ry2 = cy + rectHalfW * perpSin;
                    const rx3 = baseX + rectHalfW * perpCos;
                    const ry3 = baseY + rectHalfW * perpSin;
                    const rx4 = baseX - rectHalfW * perpCos;
                    const ry4 = baseY - rectHalfW * perpSin;
                    roundShapes.push('<!-- Connecting rect to center to hide lines -->');
                    roundShapes.push(`<polygon points="${fmt(rx1)},${fmt(ry1)} ${fmt(rx2)},${fmt(ry2)} ${fmt(rx3)},${fmt(ry3)} ${fmt(rx4)},${fmt(ry4)}"/>`);
                }
            }
            else {
                // Diagonal Circle
                const radius = tipW / 2;
                const dist = tipStart;
                const cxCircle = cx + dist * cos;
                const cyCircle = cy + dist * sin;
                roundShapes.push(`<circle cx="${fmt(cxCircle)}" cy="${fmt(cyCircle)}" r="${fmt(radius)}"/>`);
            }
        }
    }
    const joinedRoundShapes = roundShapes.map((s) => '    ' + s).join('\n');
    const joinedMiterSpikes = miterCardinalSpikes
        .map((s) => '    ' + s)
        .join('\n');
    const joinedFallbackSpikes = fallbackSolidSpikes
        .map((s) => '    ' + s)
        .join('\n');
    const joinedWhiteShapes = [...roundShapes, ...miterCardinalSpikes]
        .map((s) => '    ' + s)
        .join('\n');
    const miterSpikeGroup = miterCardinalSpikes.length > 0
        ? `\n  <g fill="${p.strokeColor}" stroke="${p.strokeColor}" stroke-width="${p.outerRingWidth * 2}" stroke-linejoin="miter" stroke-miterlimit="40">\n${joinedMiterSpikes}\n  </g>`
        : '';
    const fallbackSpikeGroup = fallbackSolidSpikes.length > 0
        ? `\n  <g fill="${p.strokeColor}" stroke="none">\n${joinedFallbackSpikes}\n  </g>`
        : '';
    // Pass 1: Silhouette outline for merged outer structure + mitered cardinal spikes
    return `
  <!-- Pass 1: Silhouette outline for merged outer structure -->
  <g fill="${p.strokeColor}" stroke="${p.strokeColor}" stroke-width="${p.outerRingWidth * 2}" stroke-linejoin="round">
${joinedRoundShapes}
  </g>${miterSpikeGroup}${fallbackSpikeGroup}
  <!-- Pass 2: Knockout fill for merged outer structure (white) -->
  <g fill="${p.fillLight}" stroke="none">
${joinedWhiteShapes}
  </g>
  `;
}
// ---------------------------------------------------------------------------
// Full SVG assembly
// ---------------------------------------------------------------------------
export function computeViewSize(_p) {
    return 400; // Fixed size so optimization scaling is stable and 1:1 with diff canvas
}
export function buildFullSvg(p, size, previewPad = 0) {
    const viewSize = size || computeViewSize(p);
    const cx = viewSize / 2;
    const cy = viewSize / 2;
    const totalSize = viewSize + previewPad * 2;
    const minCoord = -previewPad;
    const parts = [];
    // Background
    if (!p.transparentBg) {
        parts.push(`<rect x="${minCoord}" y="${minCoord}" width="${totalSize}" height="${totalSize}" fill="${p.bgColor}"/>`);
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
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minCoord} ${minCoord} ${totalSize} ${totalSize}" width="${totalSize}" height="${totalSize}">`,
        parts.join('\n'),
        '</svg>',
    ].join('\n');
}
