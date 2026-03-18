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
 *   pnpm exec tsc --project mini-tools/logo-maker/tsconfig.json
 *
 * Loaded by iliqchuan-logo-maker.html as:
 *   <script type="module" src="logo-maker/build/main.js"></script>
 */

import { LogoParams, $ } from './types.js';
import { getParams, saveParams, loadParams, hasSavedParams } from './params.js';
import { buildYinYangSvg, buildRingsSvg, buildTextSvg, buildMergedOuterBaseSvg, buildFullSvg, computeViewSize } from './svg-builders.js';
import { updateDiff, loadReferenceImage, setReferenceImage } from './pixel-diff.js';
import { STAGES, runOptimization } from './optimizer.js';

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
  $('innerRingGap-val').textContent = String(p.innerRingGap);
  $('textBandWidth-val').textContent = String(p.textBandWidth);
  $('outerRingGap-val').textContent = String(p.outerRingGap);
  $('outerRingWidth-val').textContent = String(p.outerRingWidth);

  $('textSizeUpper-val').textContent = String(p.textSizeUpper);
  $('textSizeLower-val').textContent = String(p.textSizeLower);
  $('textOffsetUpper-val').textContent = String(p.textOffsetUpper);
  $('textOffsetLower-val').textContent = String(p.textOffsetLower);
  $('textLetterSpacingLower-val').textContent = String(p.textLetterSpacingLower);
  $('cardinalTipDistance-val').textContent = String(p.cardinalTipDistance);
  $('diagonalTipDistance-val').textContent = String(p.diagonalTipDistance);
  $('cardinalTipLength-val').textContent = String(p.cardinalTipLength);
  $('cardinalTipWidth-val').textContent = String(p.cardinalTipWidth);
  $('cardinalTipConcavity-val').textContent = p.cardinalTipConcavity.toFixed(1);
  $('cardinalTipThirdBumpDistance-val').textContent = String(p.cardinalTipThirdBumpDistance);
  $('cardinalTipThirdBumpRadius-val').textContent = String(p.cardinalTipThirdBumpRadius);
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

  content += buildMergedOuterBaseSvg(cx, cy, p);
  content += buildYinYangSvg(cx, cy, p);
  content += buildRingsSvg(cx, cy, p);
  content += buildTextSvg(cx, cy, p);

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
    'innerRingWidth', 'innerRingGap', 'textBandWidth', 'outerRingGap', 'outerRingWidth',
    'textSizeUpper', 'textSizeLower', 'textOffsetUpper', 'textOffsetLower', 'textLetterSpacingLower',
    'cardinalTipDistance', 'diagonalTipDistance',
    'cardinalTipLength', 'cardinalTipWidth', 'cardinalTipConcavity', 'cardinalTipThirdBumpDistance', 'cardinalTipThirdBumpRadius', 'diagonalTipLength', 'diagonalTipWidth',
    'strokeColor', 'fillLight', 'fillDark', 'bgColor',
  ];

  for (const id of controlIds) {
    const el = $(id) as HTMLInputElement;
    el.addEventListener('input', update);
  }

  $('transparentBg').addEventListener('change', update);

  // Save / Load
  $('save-btn').addEventListener('click', () => saveParams(update));
  $('load-btn').addEventListener('click', () => {
    loadParams(update);
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

  // Optimize button
  $('opt-btn').addEventListener('click', () => runOptimization(update));

  // Inject per-property optimize buttons
  controlIds.forEach(id => {
    const stageForParam = STAGES.find(s => s.params.some(p => p.id === id));
    if (stageForParam) {
      const label = $(`${id}-val`)?.parentElement;
      if (label) {
        const btn = document.createElement('button');
        btn.className = 'opt-btn-small';
        btn.textContent = '⚡';
        btn.title = 'Optimize this property';
        btn.addEventListener('click', () => {
          const paramDef = stageForParam!.params.find(p => p.id === id)!;
          runOptimization(update, [{
            name: `Optimize ${id}`,
            maskKeys: stageForParam!.maskKeys,
            params: [paramDef]
          }]);
        });
        label.appendChild(btn);
      }
    }
  });

  // Inject per-group optimize buttons
  document.querySelectorAll('.section-title').forEach(section => {
    const sectionName = section.textContent?.trim() || '';
    const paramsInGroup: Array<{id: keyof LogoParams, step: number}> = [];
    let nextEl = section.nextElementSibling;
    while (nextEl && !nextEl.classList.contains('section-title')) {
      if (nextEl.classList.contains('control-group')) {
        const input = nextEl.querySelector('input[type="range"]');
        if (input && input.id) {
          const id = input.id;
          const stageForParam = STAGES.find(s => s.params.some(p => p.id === id));
          if (stageForParam) {
            paramsInGroup.push({
              id: id as keyof LogoParams,
              step: stageForParam.params.find(p => p.id === id)!.step
            });
          }
        }
      }
      nextEl = nextEl.nextElementSibling;
    }

    if (paramsInGroup.length > 0) {
      const btn = document.createElement('button');
      btn.className = 'opt-btn-small group-opt';
      btn.innerHTML = '⚡ Opt';
      btn.title = `Optimize all in ${sectionName}`;
      btn.addEventListener('click', () => {
        const stagesToRun = STAGES.map(s => {
          const matchingParams = s.params.filter(sp => paramsInGroup.some(pg => pg.id === sp.id));
          if (matchingParams.length > 0) {
            return {
              name: `${s.name} (${sectionName})`,
              maskKeys: s.maskKeys,
              params: matchingParams
            };
          }
          return null;
        }).filter(s => s !== null) as typeof STAGES;
        
        runOptimization(update, stagesToRun);
      });
      section.appendChild(btn);
    }
  });

  // Reference image for pixel diff
  const refInput = $('ref-image-input') as HTMLInputElement;
  refInput.addEventListener('change', () => {
    const file = refInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const img = await loadReferenceImage(reader.result as string);
        setReferenceImage(img);
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
    setReferenceImage(img);
    $('ref-status').textContent = 'Loaded: iliqchuan-white-bg.png (auto)';
    update();
    // Auto-run optimizer on page load after reference is ready
    setTimeout(() => runOptimization(update), 500);
  }).catch(() => {
    $('ref-status').textContent = 'No reference loaded (use file picker or serve via HTTP)';
  });

  // Try loading saved params
  if (hasSavedParams()) {
    loadParams(update);
  }

  update();
}

// Start
init();
