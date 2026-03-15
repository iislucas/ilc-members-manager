/* Logo Maker – Hill-climbing optimizer (coordinate descent).
 *
 * Defines the optimization stages and the runOptimization function that
 * systematically adjusts logo parameters to minimize RMSE against a reference.
 */
import { $ } from './types.js';
import { getParams } from './params.js';
import { computeRMSEFast, referenceImage } from './pixel-diff.js';
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
// ---------------------------------------------------------------------------
// Optimizer
// ---------------------------------------------------------------------------
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
