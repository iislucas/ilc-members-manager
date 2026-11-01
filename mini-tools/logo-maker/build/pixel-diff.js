/* Logo Maker – Pixel diff comparison and fast RMSE computation.
 *
 * Provides functions for comparing the generated SVG against a reference image
 * (transparent PNG or white-background JPEG), both visually (heatmap) and
 * numerically (RMSE scores).
 */
import { $ } from './types.js';
import { buildFullSvg, computeViewSize } from './svg-builders.js';
export const PREVIEW_PAD = 5;
const DIFF_VIEW_SIZE = 400;
const PREVIEW_CANVAS_SIZE = DIFF_VIEW_SIZE + PREVIEW_PAD * 2;
const FAST_SIZE = 200;
// ---------------------------------------------------------------------------
// Reference image loading & normalization
// ---------------------------------------------------------------------------
export let referenceImage = null;
let refPreviewCanvas = null;
let refFastData = null;
function prepareReferenceCanvases(img) {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(img, 0, 0, srcW, srcH);
    const imgData = srcCtx.getImageData(0, 0, srcW, srcH);
    const d = imgData.data;
    const corners = [
        0,
        (srcW - 1) * 4,
        (srcH - 1) * srcW * 4,
        ((srcH - 1) * srcW + (srcW - 1)) * 4,
    ];
    let minCornerAlpha = 255;
    let sumCornerLum = 0;
    for (const idx of corners) {
        if (d[idx + 3] < minCornerAlpha)
            minCornerAlpha = d[idx + 3];
        sumCornerLum += (d[idx] + d[idx + 1] + d[idx + 2]) / 3;
    }
    const isOpaqueWhiteBg = minCornerAlpha >= 200 && sumCornerLum / 4 >= 220;
    const pCanvas = document.createElement('canvas');
    pCanvas.width = PREVIEW_CANVAS_SIZE;
    pCanvas.height = PREVIEW_CANVAS_SIZE;
    const pCtx = pCanvas.getContext('2d');
    pCtx.imageSmoothingEnabled = true;
    pCtx.imageSmoothingQuality = 'high';
    const fCanvas = document.createElement('canvas');
    fCanvas.width = FAST_SIZE;
    fCanvas.height = FAST_SIZE;
    const fCtx = fCanvas.getContext('2d');
    fCtx.imageSmoothingEnabled = true;
    fCtx.imageSmoothingQuality = 'high';
    if (isOpaqueWhiteBg) {
        const n = srcW * srcH;
        const lum = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const p = i * 4;
            lum[i] = (d[p] + d[p + 1] + d[p + 2]) / 3;
        }
        // 1. Isolate the central connected emblem so detached corner marks (e.g. ®) are ignored.
        const centralDark = new Uint8Array(n);
        const queue = new Int32Array(n);
        let qHead = 0;
        let qTail = 0;
        const cx0 = srcW / 2;
        const cy0 = srcH / 2;
        const seedR2 = Math.pow(0.35 * Math.min(srcW, srcH), 2);
        for (let y = 0; y < srcH; y++) {
            for (let x = 0; x < srcW; x++) {
                const idx = y * srcW + x;
                const dist2 = (x - cx0) * (x - cx0) + (y - cy0) * (y - cy0);
                if (dist2 < seedR2 && lum[idx] < 200) {
                    centralDark[idx] = 1;
                    queue[qTail++] = idx;
                }
            }
        }
        while (qHead < qTail) {
            const idx = queue[qHead++];
            const x = idx % srcW;
            const y = (idx - x) / srcW;
            for (let dy = -1; dy <= 1; dy++) {
                const ny = y + dy;
                if (ny < 0 || ny >= srcH)
                    continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    if (nx < 0 || nx >= srcW)
                        continue;
                    const nIdx = ny * srcW + nx;
                    if (!centralDark[nIdx] && lum[nIdx] < 215) {
                        centralDark[nIdx] = 1;
                        queue[qTail++] = nIdx;
                    }
                }
            }
        }
        // Dilate centralDark by 3px to preserve outer anti-aliased fringe, then clear outer artifacts.
        let nearDark = centralDark;
        for (let step = 0; step < 3; step++) {
            const next = new Uint8Array(nearDark);
            for (let y = 1; y < srcH - 1; y++) {
                for (let x = 1; x < srcW - 1; x++) {
                    const idx = y * srcW + x;
                    if (nearDark[idx]) {
                        next[idx - srcW - 1] = 1;
                        next[idx - srcW] = 1;
                        next[idx - srcW + 1] = 1;
                        next[idx - 1] = 1;
                        next[idx + 1] = 1;
                        next[idx + srcW - 1] = 1;
                        next[idx + srcW] = 1;
                        next[idx + srcW + 1] = 1;
                    }
                }
            }
            nearDark = next;
        }
        const outerArtifactR2 = Math.pow(0.38 * Math.min(srcW, srcH), 2);
        for (let y = 0; y < srcH; y++) {
            for (let x = 0; x < srcW; x++) {
                const idx = y * srcW + x;
                const dist2 = (x - cx0) * (x - cx0) + (y - cy0) * (y - cy0);
                if (!nearDark[idx] && dist2 > outerArtifactR2) {
                    lum[idx] = 255;
                    const p = idx * 4;
                    d[p] = 255;
                    d[p + 1] = 255;
                    d[p + 2] = 255;
                }
            }
        }
        // 2. Flood-fill exterior white background from the 4 borders.
        const exterior = new Uint8Array(n);
        qHead = 0;
        qTail = 0;
        const pushBorder = (idx) => {
            if (!exterior[idx] && lum[idx] > 140) {
                exterior[idx] = 1;
                queue[qTail++] = idx;
            }
        };
        for (let x = 0; x < srcW; x++) {
            pushBorder(x);
            pushBorder((srcH - 1) * srcW + x);
        }
        for (let y = 0; y < srcH; y++) {
            pushBorder(y * srcW);
            pushBorder(y * srcW + (srcW - 1));
        }
        while (qHead < qTail) {
            const idx = queue[qHead++];
            const x = idx % srcW;
            const y = (idx - x) / srcW;
            if (x > 0)
                pushBorder(idx - 1);
            if (x + 1 < srcW)
                pushBorder(idx + 1);
            if (y > 0)
                pushBorder(idx - srcW);
            if (y + 1 < srcH)
                pushBorder(idx + srcW);
        }
        // Convert exterior background and anti-aliased outer silhouette fringe to clean alpha.
        for (let y = 0; y < srcH; y++) {
            for (let x = 0; x < srcW; x++) {
                const idx = y * srcW + x;
                let isOuter = exterior[idx] === 1;
                if (!isOuter) {
                    for (let dy = -1; dy <= 1 && !isOuter; dy++) {
                        const ny = y + dy;
                        if (ny < 0 || ny >= srcH)
                            continue;
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx;
                            if (nx < 0 || nx >= srcW)
                                continue;
                            const nIdx = ny * srcW + nx;
                            if (exterior[nIdx] && lum[nIdx] >= 215) {
                                isOuter = true;
                                break;
                            }
                        }
                    }
                }
                if (isOuter) {
                    const p = idx * 4;
                    if (lum[idx] >= 246) {
                        d[p] = 0;
                        d[p + 1] = 0;
                        d[p + 2] = 0;
                        d[p + 3] = 0;
                    }
                    else {
                        const alpha = Math.round(Math.max(0, Math.min(255, 255 - lum[idx])));
                        d[p] = 0;
                        d[p + 1] = 0;
                        d[p + 2] = 0;
                        d[p + 3] = alpha;
                    }
                }
            }
        }
        srcCtx.putImageData(imgData, 0, 0);
        // 3. Measure tight emblem bounds and align cardinal tips to r = 199 in 400x400 space.
        let minX = srcW;
        let maxX = 0;
        let minY = srcH;
        let maxY = 0;
        for (let y = 0; y < srcH; y++) {
            for (let x = 0; x < srcW; x++) {
                const idx = y * srcW + x;
                if (centralDark[idx] && lum[idx] < 190) {
                    if (x < minX)
                        minX = x;
                    if (x > maxX)
                        maxX = x;
                    if (y < minY)
                        minY = y;
                    if (y > maxY)
                        maxY = y;
                }
            }
        }
        if (maxX > minX && maxY > minY) {
            const cxRef = (minX + maxX + 1) / 2;
            const cyRef = (minY + maxY + 1) / 2;
            const span = Math.max(maxX - minX + 1, maxY - minY + 1);
            const emblemScale = 398 / span;
            pCtx.drawImage(srcCanvas, 0, 0, srcW, srcH, DIFF_VIEW_SIZE / 2 + PREVIEW_PAD - cxRef * emblemScale, DIFF_VIEW_SIZE / 2 + PREVIEW_PAD - cyRef * emblemScale, srcW * emblemScale, srcH * emblemScale);
            const fastScale = emblemScale * (FAST_SIZE / DIFF_VIEW_SIZE);
            fCtx.drawImage(srcCanvas, 0, 0, srcW, srcH, FAST_SIZE / 2 - cxRef * fastScale, FAST_SIZE / 2 - cyRef * fastScale, srcW * fastScale, srcH * fastScale);
        }
        else {
            pCtx.drawImage(srcCanvas, PREVIEW_PAD, PREVIEW_PAD, DIFF_VIEW_SIZE, DIFF_VIEW_SIZE);
            fCtx.drawImage(srcCanvas, 0, 0, FAST_SIZE, FAST_SIZE);
        }
    }
    else {
        pCtx.drawImage(img, PREVIEW_PAD, PREVIEW_PAD, DIFF_VIEW_SIZE, DIFF_VIEW_SIZE);
        fCtx.drawImage(img, 0, 0, FAST_SIZE, FAST_SIZE);
    }
    refPreviewCanvas = pCanvas;
    refFastData = fCtx.getImageData(0, 0, FAST_SIZE, FAST_SIZE).data;
}
export function setReferenceImage(img) {
    referenceImage = img;
    if (img) {
        prepareReferenceCanvases(img);
    }
    else {
        refPreviewCanvas = null;
        refFastData = null;
    }
}
export function loadReferenceImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}
// ---------------------------------------------------------------------------
// Full diff (visual heatmap + RMSE)
// ---------------------------------------------------------------------------
export async function updateDiff(p) {
    if (!referenceImage || !refPreviewCanvas)
        return;
    const canvasSize = PREVIEW_CANVAS_SIZE;
    const refCanvas = $('ref-canvas');
    const genCanvas = $('gen-canvas');
    const diffColorCanvas = $('diff-color-canvas');
    const diffAlphaCanvas = $('diff-alpha-canvas');
    refCanvas.width = canvasSize;
    refCanvas.height = canvasSize;
    genCanvas.width = canvasSize;
    genCanvas.height = canvasSize;
    diffColorCanvas.width = canvasSize;
    diffColorCanvas.height = canvasSize;
    diffAlphaCanvas.width = canvasSize;
    diffAlphaCanvas.height = canvasSize;
    // Draw normalized reference on padded preview canvas
    const refCtx = refCanvas.getContext('2d');
    refCtx.clearRect(0, 0, canvasSize, canvasSize);
    refCtx.drawImage(refPreviewCanvas, 0, 0);
    // 1. True representation for the visual UI "Generated" canvas (with 5px preview pad)
    const genCtx = genCanvas.getContext('2d');
    const visualSvgStr = buildFullSvg(p, undefined, PREVIEW_PAD);
    const visualBlob = new Blob([visualSvgStr], {
        type: 'image/svg+xml;charset=utf-8',
    });
    const visualUrl = URL.createObjectURL(visualBlob);
    const visualSvgImg = await loadReferenceImage(visualUrl);
    genCtx.clearRect(0, 0, canvasSize, canvasSize);
    genCtx.drawImage(visualSvgImg, 0, 0, canvasSize, canvasSize);
    URL.revokeObjectURL(visualUrl);
    // 2. Forced transparent representation for the mathematical diff
    const mathSvgStr = buildFullSvg({ ...p, transparentBg: true }, undefined, PREVIEW_PAD);
    const mathBlob = new Blob([mathSvgStr], {
        type: 'image/svg+xml;charset=utf-8',
    });
    const mathUrl = URL.createObjectURL(mathBlob);
    const mathSvgImg = await loadReferenceImage(mathUrl);
    const mathCanvas = document.createElement('canvas');
    mathCanvas.width = canvasSize;
    mathCanvas.height = canvasSize;
    const mathCtx = mathCanvas.getContext('2d');
    mathCtx.clearRect(0, 0, canvasSize, canvasSize);
    mathCtx.drawImage(mathSvgImg, 0, 0, canvasSize, canvasSize);
    URL.revokeObjectURL(mathUrl);
    // Get pixel data
    const refRawData = refCtx.getImageData(0, 0, canvasSize, canvasSize).data;
    const genRawData = mathCtx.getImageData(0, 0, canvasSize, canvasSize).data;
    const diffColorCtx = diffColorCanvas.getContext('2d');
    const diffColorImgData = diffColorCtx.createImageData(canvasSize, canvasSize);
    const diffColorData = diffColorImgData.data;
    const diffAlphaCtx = diffAlphaCanvas.getContext('2d');
    const diffAlphaImgData = diffAlphaCtx.createImageData(canvasSize, canvasSize);
    const diffAlphaData = diffAlphaImgData.data;
    let sumSqErrColor = 0;
    let sumSqErrAlpha = 0;
    const normPixels = DIFF_VIEW_SIZE * DIFF_VIEW_SIZE;
    for (let i = 0; i < refRawData.length; i += 4) {
        const refAlpha = refRawData[i + 3];
        const genAlpha = genRawData[i + 3];
        const da = Math.abs(refAlpha - genAlpha);
        sumSqErrAlpha += da * da;
        // Color RMSE: composite onto white background for evaluation
        const rA = refAlpha / 255;
        const gA = genAlpha / 255;
        const refR = refRawData[i] * rA + 255 * (1 - rA);
        const refG = refRawData[i + 1] * rA + 255 * (1 - rA);
        const refB = refRawData[i + 2] * rA + 255 * (1 - rA);
        const genR = genRawData[i] * gA + 255 * (1 - gA);
        const genG = genRawData[i + 1] * gA + 255 * (1 - gA);
        const genB = genRawData[i + 2] * gA + 255 * (1 - gA);
        const dr = Math.abs(refR - genR);
        const dg = Math.abs(refG - genG);
        const db = Math.abs(refB - genB);
        const diffColor = (dr + dg + db) / 3;
        sumSqErrColor += diffColor * diffColor;
        // Color Mismatch Heatmap (Red)
        const colorIntensity = Math.min(255, diffColor * 3);
        diffColorData[i] = 255;
        diffColorData[i + 1] = 0;
        diffColorData[i + 2] = 0;
        diffColorData[i + 3] = colorIntensity;
        // Transparency Mismatch Heatmap (Black & White)
        const alphaIntensity = Math.min(255, da * 3);
        diffAlphaData[i] = 0;
        diffAlphaData[i + 1] = 0;
        diffAlphaData[i + 2] = 0;
        diffAlphaData[i + 3] = alphaIntensity;
    }
    diffColorCtx.putImageData(diffColorImgData, 0, 0);
    diffAlphaCtx.putImageData(diffAlphaImgData, 0, 0);
    const rmseColor = Math.sqrt(sumSqErrColor / normPixels);
    const rmseAlpha = Math.sqrt(sumSqErrAlpha / normPixels);
    $('rmse-score').textContent =
        `Color: ${rmseColor.toFixed(2)}  Alpha: ${rmseAlpha.toFixed(2)}`;
    return { color: rmseColor, alpha: rmseAlpha };
}
// ---------------------------------------------------------------------------
// Fast offscreen RMSE computation (for optimization)
// ---------------------------------------------------------------------------
export function computeStageMaskRadius(p, maskParamKeys) {
    if (!maskParamKeys || maskParamKeys.length === 0)
        return undefined;
    let maskR = 0;
    for (const key of maskParamKeys) {
        if (typeof p[key] === 'number') {
            maskR += p[key];
        }
    }
    // Generous fixed padding so stepping a ring parameter up/down never moves edges out of the mask.
    return maskR + 6;
}
export async function computeRMSEFast(p, fixedMaskRadius) {
    if (!referenceImage || !refFastData) {
        return { color: Infinity, alpha: Infinity };
    }
    const size = FAST_SIZE;
    const offGen = document.createElement('canvas');
    offGen.width = size;
    offGen.height = size;
    const genCtx = offGen.getContext('2d');
    genCtx.clearRect(0, 0, size, size);
    const svgStr = buildFullSvg({ ...p, transparentBg: true });
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const svgImg = await loadReferenceImage(url);
    genCtx.drawImage(svgImg, 0, 0, size, size);
    URL.revokeObjectURL(url);
    const refData = refFastData;
    const genData = genCtx.getImageData(0, 0, size, size).data;
    // Use the caller's fixed mask radius so candidate steps compare identical pixel sets
    let activePixels = 0;
    let maskRadiusSq = Infinity;
    if (fixedMaskRadius !== undefined) {
        const viewSize = computeViewSize(p);
        const scaledMaskR = fixedMaskRadius * (size / viewSize);
        maskRadiusSq = scaledMaskR * scaledMaskR;
    }
    const cx = size / 2;
    const cy = size / 2;
    let sumSqColor = 0;
    let sumSqAlpha = 0;
    for (let i = 0; i < refData.length; i += 4) {
        if (maskRadiusSq !== Infinity) {
            const px = (i / 4) % size;
            const py = Math.floor(i / 4 / size);
            const distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
            if (distSq > maskRadiusSq)
                continue;
        }
        activePixels++;
        const refAlpha = refData[i + 3];
        const genAlpha = genData[i + 3];
        const da = Math.abs(refAlpha - genAlpha);
        sumSqAlpha += da * da;
        const rA = refAlpha / 255;
        const gA = genAlpha / 255;
        const refR = refData[i] * rA + 255 * (1 - rA);
        const refG = refData[i + 1] * rA + 255 * (1 - rA);
        const refB = refData[i + 2] * rA + 255 * (1 - rA);
        const genR = genData[i] * gA + 255 * (1 - gA);
        const genG = genData[i + 1] * gA + 255 * (1 - gA);
        const genB = genData[i + 2] * gA + 255 * (1 - gA);
        const dr = Math.abs(refR - genR);
        const dg = Math.abs(refG - genG);
        const db = Math.abs(refB - genB);
        const d = (dr + dg + db) / 3;
        sumSqColor += d * d;
    }
    if (activePixels === 0)
        activePixels = 1;
    return {
        color: Math.sqrt(sumSqColor / activePixels),
        alpha: Math.sqrt(sumSqAlpha / activePixels),
    };
}
