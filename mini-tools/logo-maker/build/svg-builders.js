/* Logo Maker – SVG geometry builders.
 *
 * Pure functions that generate SVG markup strings for each layer of the logo:
 * yin-yang, rings, text arcs, spokes, ornamental tips, and full SVG assembly.
 */
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
// Rings: dark filled text band annulus + border rings.
export function buildRingsSvg(cx, cy, p) {
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
    const parts = [];
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
// Text
// ---------------------------------------------------------------------------
// Text along circular arcs using <textPath>.
export function buildTextSvg(cx, cy, p) {
    // The text band center radius
    const yinYangBorderWidth = 1.5;
    const yinYangOuterR = p.yinYangRadius + yinYangBorderWidth / 2;
    const bandInnerR = yinYangOuterR + p.innerRingWidth + p.innerRingGap;
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
// ---------------------------------------------------------------------------
// Spokes
// ---------------------------------------------------------------------------
// 8 spokes radiating from the outer ring.
export function buildSpokesSvg(cx, cy, p) {
    const yinYangBorderWidth = 1.5;
    const outerRingOuterEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
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
// ---------------------------------------------------------------------------
// Ornamental Tips
// ---------------------------------------------------------------------------
// Ornamental tips at the end of each spoke.
// Cardinal (N,E,S,W) — trefoil shape made of overlapping circles
// Diagonal (NE,SE,SW,NW) — simple perfect circle
export function buildTipsSvg(cx, cy, p) {
    const yinYangBorderWidth = 1.5;
    const outerRingOuterEdge = p.yinYangRadius + yinYangBorderWidth / 2 + p.innerRingWidth + p.innerRingGap + p.textBandWidth + p.outerRingGap + p.outerRingWidth;
    const tipStart = outerRingOuterEdge + p.spokeLength;
    const parts = [];
    const silhouettes = [];
    const interiors = [];
    const addShape = (svgShape) => {
        silhouettes.push(svgShape);
        interiors.push(svgShape);
    };
    for (let i = 0; i < 8; i++) {
        const angleDeg = i * 45;
        const angle = angleDeg * Math.PI / 180;
        const isCardinal = angleDeg % 90 === 0;
        const tipLen = isCardinal ? p.cardinalTipLength : p.diagonalTipLength;
        const tipW = isCardinal ? p.cardinalTipWidth : p.diagonalTipWidth;
        if (tipLen <= 0 || tipW <= 0)
            continue;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const perpCos = Math.cos(angle + Math.PI / 2);
        const perpSin = Math.sin(angle + Math.PI / 2);
        const innerCut = p.spokeLength <= 1 ? p.outerRingWidth + 1.5 : 0;
        if (isCardinal) {
            // Head circle scaling
            const headR = Math.min(tipW * 0.4, tipLen * 0.5);
            const stemLen = typeof tipLen === 'number' && typeof headR === 'number' ? tipLen - headR : 0;
            const headDist = tipStart + stemLen;
            const headX = cx + headDist * cos;
            const headY = cy + headDist * sin;
            // Side flanking circles
            const sideR = tipW * 0.3;
            const sideDist = tipStart + stemLen * 0.55;
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
            const stemX1_int = cx + (tipStart - innerCut) * cos - baseW * perpCos;
            const stemY1_int = cy + (tipStart - innerCut) * sin - baseW * perpSin;
            const stemX2_int = cx + (tipStart - innerCut) * cos + baseW * perpCos;
            const stemY2_int = cy + (tipStart - innerCut) * sin + baseW * perpSin;
            const topX1 = cx + (tipStart + stemLen * 0.9) * cos - baseW * perpCos;
            const topY1 = cy + (tipStart + stemLen * 0.9) * sin - baseW * perpSin;
            const topX2 = cx + (tipStart + stemLen * 0.9) * cos + baseW * perpCos;
            const topY2 = cy + (tipStart + stemLen * 0.9) * sin + baseW * perpSin;
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
        else {
            // Diagonal tips: simple single perfect circle
            const radius = tipW / 2;
            const dist = tipStart + Math.max(0, tipLen - radius);
            const cx_circle = cx + dist * cos;
            const cy_circle = cy + dist * sin;
            silhouettes.push(`<circle cx="${cx_circle}" cy="${cy_circle}" r="${radius}"/>`);
            interiors.push(`<circle cx="${cx_circle}" cy="${cy_circle}" r="${radius}"/>`);
            // Seamlessly connect and cut the outer ring stroke if there is no spoke gap
            if (innerCut > 0) {
                const d_center = dist - tipStart;
                if (d_center < radius) {
                    // Find width of circle intersection at the outer ring radius
                    const cutW = Math.sqrt(radius * radius - d_center * d_center) * 0.85; // slightly narrower than true intersection
                    const cutX1 = cx + (tipStart - innerCut) * cos - cutW * perpCos;
                    const cutY1 = cy + (tipStart - innerCut) * sin - cutW * perpSin;
                    const cutX2 = cx + (tipStart - innerCut) * cos + cutW * perpCos;
                    const cutY2 = cy + (tipStart - innerCut) * sin + cutW * perpSin;
                    const poly = `<polygon points="${cutX1},${cutY1} ${cutX2},${cutY2} ${cx_circle},${cy_circle}"/>`;
                    silhouettes.push(poly);
                    interiors.push(poly);
                }
            }
        }
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
export function computeViewSize(p) {
    return 400; // Fixed size so optimization scaling is stable and 1:1 with diff canvas
}
export function buildFullSvg(p, size) {
    const viewSize = size || computeViewSize(p);
    const cx = viewSize / 2;
    const cy = viewSize / 2;
    const parts = [];
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
