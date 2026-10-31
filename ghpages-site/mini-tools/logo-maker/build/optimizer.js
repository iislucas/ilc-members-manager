/* Logo Maker – Hill-climbing optimizer (coordinate descent).
 *
 * Defines the optimization stages and the runOptimization function that
 * systematically adjusts logo parameters to minimize RMSE against a reference.
 */
import { $ } from './types.js';
import { getParams } from './params.js';
import { computeRMSEFast, computeStageMaskRadius, referenceImage } from './pixel-diff.js';
// ---------------------------------------------------------------------------
// Optimization stages
// ---------------------------------------------------------------------------
// The optimization sequence proceeds in stages to build outwards.
// For each stage, we use a radial mask bounding the outer edge of its components.
export const STAGES = [
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
            { id: 'innerRingWidth', step: 0.25 },
            { id: 'innerRingGap', step: 0.25 },
        ],
    },
    {
        name: 'Band',
        maskKeys: ['yinYangRadius', 'innerRingWidth', 'innerRingGap', 'textBandWidth'],
        params: [
            { id: 'textBandWidth', step: 0.5 },
        ],
    },
    {
        name: 'Outer Rings',
        maskKeys: ['yinYangRadius', 'innerRingWidth', 'innerRingGap', 'textBandWidth', 'outerRingGap', 'outerRingWidth'],
        params: [
            { id: 'outerRingGap', step: 0.25 },
            { id: 'outerRingWidth', step: 0.25 },
        ],
    },
    {
        name: 'Decorations',
        maskKeys: [], // unlimited
        params: [
            { id: 'outerRingGap', step: 0.25 },
            { id: 'outerRingWidth', step: 0.25 },
            { id: 'chineseGlyphSize', step: 0.5 },
            { id: 'chineseRadialOffset', step: 0.5 },
            { id: 'chineseSpreadAngle', step: 0.5 },
            { id: 'chineseTiltAngle', step: 0.5 },
            { id: 'textSizeLower', step: 0.5 },
            { id: 'textOffsetLower', step: 0.5 },
            { id: 'textLetterSpacingLower', step: 0.5 },
            { id: 'textWordSpacingLower', step: 1 },
            { id: 'nsewDecorationDistance', step: 0.5 },
            { id: 'diagonalDecorationDistance', step: 0.5 },
            { id: 'nsewDecorationLength', step: 0.5 },
            { id: 'nsewDecorationWidth', step: 0.5 },
            { id: 'nsewDecorationConcavity', step: 0.1 },
            { id: 'nsewDecorationThirdBumpDistance', step: 0.5 },
            { id: 'nsewDecorationThirdBumpRadius', step: 0.25 },
            { id: 'diagonalDecorationWidth', step: 0.5 },
        ],
    },
];
// Dedicated stage for per-letter arc offsets (invoked via per-letter ⚡ or group ⚡ Opt
// so global ⚡ Optimize preserves custom optical kerning unless explicitly requested).
export const LETTER_POSITION_STAGE = {
    name: 'Letter Positions',
    maskKeys: ['yinYangRadius', 'innerRingWidth', 'innerRingGap', 'textBandWidth'],
    params: [
        { id: 'letterOffsetI1', step: 0.25 },
        { id: 'letterOffsetL', step: 0.25 },
        { id: 'letterOffsetI2', step: 0.25 },
        { id: 'letterOffsetQ', step: 0.25 },
        { id: 'letterOffsetC', step: 0.25 },
        { id: 'letterOffsetH', step: 0.25 },
        { id: 'letterOffsetU', step: 0.25 },
        { id: 'letterOffsetA', step: 0.25 },
        { id: 'letterOffsetN', step: 0.25 },
    ],
};
export const ALL_OPTIMIZABLE_STAGES = [...STAGES, LETTER_POSITION_STAGE];
const COUPLED_PAIRS = [
    // Adjust innerRingWidth without shifting bandInnerR
    { a: 'innerRingWidth', b: 'innerRingGap', stepA: 0.25, stepB: -0.25 },
    // Adjust outerRingWidth without shifting outerRingOuterEdge
    { a: 'outerRingWidth', b: 'outerRingGap', stepA: 0.25, stepB: -0.25 },
    // Adjust cardinal base distance without shifting tipR
    { a: 'nsewDecorationDistance', b: 'nsewDecorationLength', stepA: 0.5, stepB: -0.5 },
    // Adjust diagonal circle radius without shifting its outer edge
    { a: 'diagonalDecorationDistance', b: 'diagonalDecorationWidth', stepA: -0.5, stepB: 1 },
];
let optimizing = false;
// updateFn is injected from the main module to trigger a visual refresh
export async function runOptimization(updateFn, stagesToRun = STAGES) {
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
        if (!optimizing)
            break;
        stageIndex++;
        for (let pass = 0; pass < maxPasses && optimizing; pass++) {
            let improved = false;
            for (const param of stage.params) {
                if (!optimizing)
                    break;
                const el = $(param.id);
                const min = parseFloat(el.min);
                const max = parseFloat(el.max);
                const current = parseFloat(el.value);
                let bestVal = current;
                const fixedMaskR = computeStageMaskRadius(getParams(), stage.maskKeys);
                const baseRMSE = await computeRMSEFast(getParams(), fixedMaskR);
                let bestCombined = baseRMSE.color + baseRMSE.alpha;
                // Try stepping up
                const upVal = Math.min(max, current + param.step);
                if (upVal !== current) {
                    el.value = String(upVal);
                    const upRMSE = await computeRMSEFast(getParams(), fixedMaskR);
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
                    const downRMSE = await computeRMSEFast(getParams(), fixedMaskR);
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
            // Coupled diagonal moves for interval pairs [start, start + width]
            for (const pair of COUPLED_PAIRS) {
                if (!optimizing)
                    break;
                const inStage = stage.params.some((sp) => sp.id === pair.a) &&
                    stage.params.some((sp) => sp.id === pair.b);
                if (!inStage)
                    continue;
                const elA = $(pair.a);
                const elB = $(pair.b);
                const curA = parseFloat(elA.value);
                const curB = parseFloat(elB.value);
                const minA = parseFloat(elA.min);
                const maxA = parseFloat(elA.max);
                const minB = parseFloat(elB.min);
                const maxB = parseFloat(elB.max);
                const fixedMaskR = computeStageMaskRadius(getParams(), stage.maskKeys);
                const baseRMSE = await computeRMSEFast(getParams(), fixedMaskR);
                let bestPairScore = baseRMSE.color + baseRMSE.alpha;
                let bestA = curA;
                let bestB = curB;
                for (const dir of [1, -1]) {
                    const candA = Math.min(maxA, Math.max(minA, curA + dir * pair.stepA));
                    const candB = Math.min(maxB, Math.max(minB, curB + dir * pair.stepB));
                    if (candA === curA && candB === curB)
                        continue;
                    elA.value = String(candA);
                    elB.value = String(candB);
                    const candRMSE = await computeRMSEFast(getParams(), fixedMaskR);
                    const score = candRMSE.color + candRMSE.alpha;
                    if (score < bestPairScore) {
                        bestPairScore = score;
                        bestA = candA;
                        bestB = candB;
                    }
                }
                elA.value = String(bestA);
                elB.value = String(bestB);
                if (bestA !== curA || bestB !== curB) {
                    improved = true;
                    combined = bestPairScore;
                }
            }
            // Full visual update after each pass
            updateFn();
            await new Promise(r => setTimeout(r, 50));
            if (!improved) {
                break; // Converged early on this stage
            }
        }
    }
    statusEl.textContent = `Finished! RMSE: ${combined.toFixed(2)}`;
    optimizing = false;
    btn.textContent = '⚡ Optimize';
    updateFn(); // Final visual update with best values
}
