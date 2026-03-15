/* Logo Maker – Pixel diff comparison and fast RMSE computation.
 *
 * Provides functions for comparing the generated SVG against a reference PNG,
 * both visually (heatmap) and numerically (RMSE scores).
 */
import { $ } from './types.js';
import { buildFullSvg, computeViewSize } from './svg-builders.js';
// ---------------------------------------------------------------------------
// Reference image loading
// ---------------------------------------------------------------------------
export let referenceImage = null;
export function setReferenceImage(img) {
    referenceImage = img;
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
export async function computeRMSEFast(p, maskParamKeys) {
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
    // Calculate mask radius
    let activePixels = 0;
    let maskRadiusSq = Infinity;
    if (maskParamKeys && maskParamKeys.length > 0) {
        let maskR = 0;
        for (const key of maskParamKeys) {
            if (typeof p[key] === 'number') {
                maskR += p[key];
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
            if (distSq > maskRadiusSq)
                continue;
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
    if (activePixels === 0)
        activePixels = 1;
    return {
        color: Math.sqrt(sumSqColor / activePixels),
        alpha: Math.sqrt(sumSqAlpha / activePixels),
    };
}
