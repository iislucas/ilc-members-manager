/* Fast Path2D coordinate-descent optimizer for variable-width calligraphic strokes.
 *
 * Optimizes global alignment/scale, whole-stroke offsets, and individual anchor
 * [x, y, r] parameters against the extracted 200x200 character alpha coverage,
 * regularized by Laplacian bending & radius smoothness so strokes stay clean.
 */

import { cloneCharacterModel } from './defaults.js';
import { rasterizePath2DObjectsAlpha } from './pixel-diff.js';
import { buildStrokeOutlinePath } from './stroke-svg.js';
import { CharacterModel, StrokeDef, VIEWBOX_SIZE } from './types.js';

const PIXEL_COUNT = VIEWBOX_SIZE * VIEWBOX_SIZE;

export interface OptimizeProgress {
  stageLabel: string;
  rmse: number;
  evaluations: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function computeAlphaMse(
  refAlpha: Uint8ClampedArray,
  genAlpha: Uint8ClampedArray,
): number {
  let sse = 0;
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const d = refAlpha[i] - genAlpha[i];
    sse += d * d;
  }
  return sse / PIXEL_COUNT;
}

// Computes smoothness & spacing regularization for a stroke relative to its starting shape.
function computeStrokeRegularization(
  stroke: StrokeDef,
  baseline: StrokeDef,
): number {
  const pts = stroke.points;
  const basePts = baseline.points;
  const n = pts.length;
  let penalty = 0;

  // Guard minimum spacing between consecutive anchors so anchors do not collapse onto each other.
  for (let i = 0; i < n - 1; i++) {
    const chord = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (chord < 2.6) {
      const diff = 2.6 - chord;
      penalty += diff * diff * 18.0;
    }
  }

  // Preserve smooth curvature relative to baseline + light damping on radius oscillation.
  for (let i = 1; i < n - 1; i++) {
    const lx = pts[i][0] - 0.5 * (pts[i - 1][0] + pts[i + 1][0]);
    const ly = pts[i][1] - 0.5 * (pts[i - 1][1] + pts[i + 1][1]);
    if (basePts.length === n) {
      const blx = basePts[i][0] - 0.5 * (basePts[i - 1][0] + basePts[i + 1][0]);
      const bly = basePts[i][1] - 0.5 * (basePts[i - 1][1] + basePts[i + 1][1]);
      const dx = lx - blx;
      const dy = ly - bly;
      penalty += (dx * dx + dy * dy) * 0.85;
    } else {
      penalty += (lx * lx + ly * ly) * 0.25;
    }

    const lr = pts[i][2] - 0.5 * (pts[i - 1][2] + pts[i + 1][2]);
    penalty += lr * lr * 1.4;
  }

  return penalty;
}

function buildPathObj(model: CharacterModel, strokeIdx: number): Path2D | null {
  const d = buildStrokeOutlinePath(
    model.strokes[strokeIdx].points,
    model.radiusScale,
    model.offsetX,
    model.offsetY,
  );
  return d ? new Path2D(d) : null;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function optimizeCharacterModel(
  initialModel: CharacterModel,
  refAlpha: Uint8ClampedArray,
  selectedStrokeOnly: number | null,
  shouldStop: () => boolean,
  onUpdate: (model: CharacterModel, progress: OptimizeProgress) => void,
): Promise<CharacterModel> {
  const model = cloneCharacterModel(initialModel);
  const baseline = cloneCharacterModel(initialModel);
  const sCount = model.strokes.length;

  const pathObjs: Array<Path2D | null> = [];
  for (let s = 0; s < sCount; s++) {
    pathObjs.push(buildPathObj(model, s));
  }

  let evals = 0;

  const evalAllStrokesReg = (): number => {
    let reg = 0;
    for (let s = 0; s < sCount; s++) {
      reg += computeStrokeRegularization(model.strokes[s], baseline.strokes[s]);
    }
    return reg;
  };

  const evaluateFull = (): { loss: number; mse: number } => {
    for (let s = 0; s < sCount; s++) {
      pathObjs[s] = buildPathObj(model, s);
    }
    const alpha = rasterizePath2DObjectsAlpha(pathObjs);
    evals++;
    const mse = computeAlphaMse(refAlpha, alpha);
    return { loss: mse + evalAllStrokesReg(), mse };
  };

  const evaluateStrokeEdit = (
    sIdx: number,
    prevRegTotal: number,
    oldStrokeReg: number,
  ): { loss: number; mse: number; newRegTotal: number; newPath: Path2D | null } => {
    const newPath = buildPathObj(model, sIdx);
    const saved = pathObjs[sIdx];
    pathObjs[sIdx] = newPath;
    const alpha = rasterizePath2DObjectsAlpha(pathObjs);
    pathObjs[sIdx] = saved;
    evals++;
    const mse = computeAlphaMse(refAlpha, alpha);
    const newStrokeReg = computeStrokeRegularization(
      model.strokes[sIdx],
      baseline.strokes[sIdx],
    );
    const newRegTotal = prevRegTotal - oldStrokeReg + newStrokeReg;
    return { loss: mse + newRegTotal, mse, newRegTotal, newPath };
  };

  let cur = evaluateFull();
  let curLoss = cur.loss;
  let curMse = cur.mse;
  let curRegTotal = evalAllStrokesReg();

  const strokeIndices: number[] =
    selectedStrokeOnly !== null &&
    selectedStrokeOnly >= 0 &&
    selectedStrokeOnly < sCount
      ? [selectedStrokeOnly]
      : Array.from({ length: sCount }, (_, i) => i);

  // Stage 1: Global alignment & brush scale (only when optimizing full character).
  if (selectedStrokeOnly === null) {
    const globalSteps = [0.8, 0.35, 0.15];
    for (const step of globalSteps) {
      if (shouldStop()) return model;

      for (const dir of [-1, 1]) {
        const candX = round2(clamp(model.offsetX + dir * step, -40, 40));
        const prevX = model.offsetX;
        model.offsetX = candX;
        const res = evaluateFull();
        if (res.loss < curLoss - 1e-4) {
          curLoss = res.loss;
          curMse = res.mse;
        } else {
          model.offsetX = prevX;
        }
      }

      for (const dir of [-1, 1]) {
        const candY = round2(clamp(model.offsetY + dir * step, -40, 40));
        const prevY = model.offsetY;
        model.offsetY = candY;
        const res = evaluateFull();
        if (res.loss < curLoss - 1e-4) {
          curLoss = res.loss;
          curMse = res.mse;
        } else {
          model.offsetY = prevY;
        }
      }

      const rStep = step * 0.04;
      for (const dir of [-1, 1]) {
        const candS = Math.round(clamp(model.radiusScale + dir * rStep, 0.5, 1.8) * 1000) / 1000;
        const prevS = model.radiusScale;
        model.radiusScale = candS;
        const res = evaluateFull();
        if (res.loss < curLoss - 1e-4) {
          curLoss = res.loss;
          curMse = res.mse;
        } else {
          model.radiusScale = prevS;
        }
      }
    }

    // Ensure pathObjs match accepted global state.
    for (let s = 0; s < sCount; s++) {
      pathObjs[s] = buildPathObj(model, s);
    }
    curRegTotal = evalAllStrokesReg();
    onUpdate(cloneCharacterModel(model), {
      stageLabel: 'Stage 1/3: Global alignment',
      rmse: Math.sqrt(curMse),
      evaluations: evals,
    });
    await yieldToBrowser();
  }

  // Stage 2: Whole-stroke translation & thickness tuning.
  for (const sStep of [0.9, 0.4]) {
    for (const sIdx of strokeIndices) {
      if (shouldStop()) return model;
      const stroke = model.strokes[sIdx];

      // Translate X and Y of entire stroke.
      for (const axis of [0, 1] as const) {
        let bestDir = 0;
        for (const dir of [-1, 1]) {
          const oldStrokeReg = computeStrokeRegularization(
            stroke,
            baseline.strokes[sIdx],
          );
          for (const pt of stroke.points) {
            pt[axis] = round2(clamp(pt[axis] + dir * sStep, -30, 230));
          }
          const res = evaluateStrokeEdit(sIdx, curRegTotal, oldStrokeReg);
          if (res.loss < curLoss - 1e-4) {
            curLoss = res.loss;
            curMse = res.mse;
            curRegTotal = res.newRegTotal;
            pathObjs[sIdx] = res.newPath;
            bestDir = dir;
            break;
          } else {
            for (const pt of stroke.points) {
              pt[axis] = round2(pt[axis] - dir * sStep);
            }
          }
        }
        void bestDir;
      }

      // Uniform radius shift on entire stroke.
      for (const dir of [-1, 1]) {
        const oldStrokeReg = computeStrokeRegularization(
          stroke,
          baseline.strokes[sIdx],
        );
        const savedR = stroke.points.map((pt) => pt[2]);
        for (const pt of stroke.points) {
          pt[2] = round2(clamp(pt[2] + dir * (sStep * 0.45), 0.5, 22));
        }
        const res = evaluateStrokeEdit(sIdx, curRegTotal, oldStrokeReg);
        if (res.loss < curLoss - 1e-4) {
          curLoss = res.loss;
          curMse = res.mse;
          curRegTotal = res.newRegTotal;
          pathObjs[sIdx] = res.newPath;
          break;
        } else {
          for (let k = 0; k < stroke.points.length; k++) {
            stroke.points[k][2] = savedR[k];
          }
        }
      }
    }

    onUpdate(cloneCharacterModel(model), {
      stageLabel: `Stage 2/3: Stroke positioning (${sStep}px)`,
      rmse: Math.sqrt(curMse),
      evaluations: evals,
    });
    await yieldToBrowser();
  }

  // Stage 3: Multi-scale per-anchor [x, y, r] refinement.
  const schedules: Array<{ posStep: number; radStep: number; label: string }> = [
    { posStep: 1.1, radStep: 0.55, label: 'Stage 3/3: Coarse anchor fit' },
    { posStep: 0.55, radStep: 0.3, label: 'Stage 3/3: Medium anchor fit' },
    { posStep: 0.25, radStep: 0.15, label: 'Stage 3/3: Sub-pixel polish' },
  ];

  let lastYieldTime = performance.now();

  for (const sched of schedules) {
    for (const sIdx of strokeIndices) {
      if (shouldStop()) return model;
      const stroke = model.strokes[sIdx];

      for (let pIdx = 0; pIdx < stroke.points.length; pIdx++) {
        const pt = stroke.points[pIdx];

        // Coordinate descent on X, Y, and Radius R.
        const coords: Array<{ idx: 0 | 1 | 2; step: number; lo: number; hi: number }> = [
          { idx: 0, step: sched.posStep, lo: -30, hi: 230 },
          { idx: 1, step: sched.posStep, lo: -30, hi: 230 },
          { idx: 2, step: sched.radStep, lo: 0.45, hi: 22 },
        ];

        for (const c of coords) {
          for (const dir of [-1, 1]) {
            const prevVal = pt[c.idx];
            const nextVal = round2(clamp(prevVal + dir * c.step, c.lo, c.hi));
            if (nextVal === prevVal) continue;

            const oldStrokeReg = computeStrokeRegularization(
              stroke,
              baseline.strokes[sIdx],
            );
            pt[c.idx] = nextVal;
            const res = evaluateStrokeEdit(sIdx, curRegTotal, oldStrokeReg);
            if (res.loss < curLoss - 1e-4) {
              curLoss = res.loss;
              curMse = res.mse;
              curRegTotal = res.newRegTotal;
              pathObjs[sIdx] = res.newPath;
              // Try one greedy continuation step in the winning direction.
              const prevVal2 = pt[c.idx];
              const nextVal2 = round2(clamp(prevVal2 + dir * c.step, c.lo, c.hi));
              if (nextVal2 !== prevVal2) {
                const oldReg2 = computeStrokeRegularization(
                  stroke,
                  baseline.strokes[sIdx],
                );
                pt[c.idx] = nextVal2;
                const res2 = evaluateStrokeEdit(sIdx, curRegTotal, oldReg2);
                if (res2.loss < curLoss - 1e-4) {
                  curLoss = res2.loss;
                  curMse = res2.mse;
                  curRegTotal = res2.newRegTotal;
                  pathObjs[sIdx] = res2.newPath;
                } else {
                  pt[c.idx] = prevVal2;
                }
              }
              break;
            } else {
              pt[c.idx] = prevVal;
            }
          }
        }
      }

      const now = performance.now();
      if (now - lastYieldTime > 45) {
        onUpdate(cloneCharacterModel(model), {
          stageLabel: `${sched.label} (stroke ${sIdx + 1}/${sCount})`,
          rmse: Math.sqrt(curMse),
          evaluations: evals,
        });
        await yieldToBrowser();
        lastYieldTime = performance.now();
      }
    }
  }

  onUpdate(cloneCharacterModel(model), {
    stageLabel: 'Optimization complete',
    rmse: Math.sqrt(curMse),
    evaluations: evals,
  });

  return model;
}
