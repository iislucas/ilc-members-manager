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
    const diffColorCanvas = $('diff-color-canvas');
    const diffAlphaCanvas = $('diff-alpha-canvas');
    refCanvas.width = diffSize;
    refCanvas.height = diffSize;
    genCanvas.width = diffSize;
    genCanvas.height = diffSize;
    diffColorCanvas.width = diffSize;
    diffColorCanvas.height = diffSize;
    diffAlphaCanvas.width = diffSize;
    diffAlphaCanvas.height = diffSize;
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
    // Get pixel data
    const refRawData = refCtx.getImageData(0, 0, diffSize, diffSize).data;
    const genRawData = genCtx.getImageData(0, 0, diffSize, diffSize).data;
    const diffColorCtx = diffColorCanvas.getContext('2d');
    const diffColorImgData = diffColorCtx.createImageData(diffSize, diffSize);
    const diffColorData = diffColorImgData.data;
    const diffAlphaCtx = diffAlphaCanvas.getContext('2d');
    const diffAlphaImgData = diffAlphaCtx.createImageData(diffSize, diffSize);
    const diffAlphaData = diffAlphaImgData.data;
    let sumSqErrColor = 0;
    let sumSqErrAlpha = 0;
    const totalPixels = diffSize * diffSize;
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
        diffColorData[i] = 255; // R
        diffColorData[i + 1] = 0; // G
        diffColorData[i + 2] = 0; // B
        diffColorData[i + 3] = colorIntensity;
        // Transparency Mismatch Heatmap (Light Green)
        const alphaIntensity = Math.min(255, da * 3);
        diffAlphaData[i] = 100; // R
        diffAlphaData[i + 1] = 255; // G
        diffAlphaData[i + 2] = 100; // B
        diffAlphaData[i + 3] = alphaIntensity;
    }
    diffColorCtx.putImageData(diffColorImgData, 0, 0);
    diffAlphaCtx.putImageData(diffAlphaImgData, 0, 0);
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
    // Draw reference on transparent empty canvas
    const refCtx = offRef.getContext('2d');
    refCtx.clearRect(0, 0, size, size);
    refCtx.drawImage(referenceImage, 0, 0, size, size);
    // Render generated on transparent empty canvas
    const genCtx = offGen.getContext('2d');
    genCtx.clearRect(0, 0, size, size);
    const svgStr = buildFullSvg({ ...p, transparentBg: true });
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
