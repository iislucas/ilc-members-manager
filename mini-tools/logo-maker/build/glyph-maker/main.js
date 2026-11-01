/* Main controller for the I Liq Chuan Chinese Character SVG Maker.
 *
 * Manages per-character stroke/anchor state (意, 力, 拳), wires the interactive
 * anchor canvas editor, live Reference/Generated/Diff comparison, coordinate-descent
 * optimizer, localStorage persistence, and clean standalone SVG/PNG exports.
 */
import { DEFAULT_CHARACTERS, GLYPH_ORDER, STROKE_PALETTE, cloneCharacterModel, normalizeCharacterModel, sanitizeHexColor, } from './defaults.js';
import { GlyphCanvasEditor } from './editor.js';
import { optimizeCharacterModel } from './optimizer.js';
import { loadGlyphReferenceAsset, setCustomGlyphReference, getGlyphReferenceAlpha, updateComparisonPanels, } from './pixel-diff.js';
import { buildCharacterPaths, buildCharacterSvg, createCharacterSvgElement, } from './stroke-svg.js';
import { EditorBackdrop, EditorTool, GlyphId, getEl, } from './types.js';
const STORAGE_KEY_PREFIX = 'ilc-chinese-glyph-v1-';
const MAX_UNDO_DEPTH = 40;
const models = {
    [GlyphId.Yi]: loadSavedOrDefault(GlyphId.Yi),
    [GlyphId.Li]: loadSavedOrDefault(GlyphId.Li),
    [GlyphId.Quan]: loadSavedOrDefault(GlyphId.Quan),
};
const undoStacks = {
    [GlyphId.Yi]: [],
    [GlyphId.Li]: [],
    [GlyphId.Quan]: [],
};
const lastMetrics = {
    [GlyphId.Yi]: null,
    [GlyphId.Li]: null,
    [GlyphId.Quan]: null,
};
let activeGlyphId = GlyphId.Yi;
let selectedAnchor = { strokeIdx: 0, pointIdx: 0 };
let cachedPaths = [];
let editor = null;
let isOptimizing = false;
let stopOptimizeRequested = false;
function loadSavedOrDefault(id) {
    const fallback = DEFAULT_CHARACTERS[id];
    try {
        const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
        if (!raw)
            return cloneCharacterModel(fallback);
        const parsed = JSON.parse(raw);
        return normalizeCharacterModel(parsed, fallback);
    }
    catch {
        return cloneCharacterModel(fallback);
    }
}
function saveGlyphToStorage(id) {
    try {
        const m = models[id];
        const payload = {
            radiusScale: m.radiusScale,
            offsetX: m.offsetX,
            offsetY: m.offsetY,
            strokes: m.strokes,
        };
        localStorage.setItem(STORAGE_KEY_PREFIX + id, JSON.stringify(payload));
    }
    catch {
        setFeedback('Could not write to localStorage');
    }
}
function clearGlyphStorage(id) {
    try {
        localStorage.removeItem(STORAGE_KEY_PREFIX + id);
    }
    catch {
        // Ignore storage removal errors in restricted browsing modes.
    }
}
function pushUndoSnapshot() {
    const stack = undoStacks[activeGlyphId];
    stack.push(cloneCharacterModel(models[activeGlyphId]));
    if (stack.length > MAX_UNDO_DEPTH) {
        stack.shift();
    }
    updateUndoButtonState();
}
function performUndo() {
    const stack = undoStacks[activeGlyphId];
    const prev = stack.pop();
    if (!prev) {
        setFeedback('Nothing to undo');
        return;
    }
    models[activeGlyphId] = prev;
    clampSelectionToModel();
    refreshAll('Undid last edit');
    updateUndoButtonState();
}
function updateUndoButtonState() {
    const btn = getEl('btn-undo');
    const count = undoStacks[activeGlyphId].length;
    btn.disabled = count === 0;
    btn.textContent = count > 0 ? `↶ Undo (${count})` : '↶ Undo';
}
function getExportOptions() {
    const fgInput = getEl('fg-color');
    const bgInput = getEl('bg-color');
    const transInput = getEl('transparent-bg');
    return {
        fgColor: sanitizeHexColor(fgInput.value, '#ffffff'),
        bgColor: sanitizeHexColor(bgInput.value, '#111827'),
        transparentBg: transInput.checked,
    };
}
function clampSelectionToModel() {
    const model = models[activeGlyphId];
    if (model.strokes.length === 0) {
        selectedAnchor = null;
        return;
    }
    if (!selectedAnchor) {
        selectedAnchor = { strokeIdx: 0, pointIdx: 0 };
        return;
    }
    const sIdx = Math.max(0, Math.min(model.strokes.length - 1, selectedAnchor.strokeIdx));
    const ptsLen = model.strokes[sIdx].points.length;
    const pIdx = Math.max(0, Math.min(ptsLen - 1, selectedAnchor.pointIdx));
    selectedAnchor = { strokeIdx: sIdx, pointIdx: pIdx };
}
function setFeedback(msg) {
    const el = getEl('status-banner');
    el.textContent = msg;
}
function renderCharacterTabsAndStrip() {
    for (const gid of GLYPH_ORDER) {
        const tab = getEl(`tab-${gid}`);
        tab.classList.toggle('active', gid === activeGlyphId);
    }
    const strip = getEl('mini-strip');
    const opts = getExportOptions();
    // Always preview miniature cards on dark ink background for legibility when fg is light.
    const previewOpts = {
        fgColor: opts.fgColor,
        bgColor: opts.transparentBg ? '#0f172a' : opts.bgColor,
        transparentBg: false,
    };
    const cards = [];
    for (const gid of GLYPH_ORDER) {
        const m = models[gid];
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'mini-char-card' + (gid === activeGlyphId ? ' active' : '');
        card.title = `Edit ${m.char} (${m.pinyin} — ${m.meaning})`;
        const svgEl = createCharacterSvgElement(m, previewOpts, 58);
        card.appendChild(svgEl);
        const meta = document.createElement('div');
        meta.className = 'mini-char-meta';
        const title = document.createElement('span');
        title.className = 'mini-char-title';
        title.textContent = `${m.char} ${m.pinyin}`;
        const sub = document.createElement('span');
        sub.className = 'mini-char-sub';
        const met = lastMetrics[gid];
        const totalPts = m.strokes.reduce((acc, s) => acc + s.points.length, 0);
        sub.textContent = met
            ? `RMSE ${met.rmse.toFixed(1)} · ${totalPts} pts`
            : `${m.strokes.length} strokes · ${totalPts} pts`;
        meta.appendChild(title);
        meta.appendChild(sub);
        card.appendChild(meta);
        card.addEventListener('click', () => {
            if (gid !== activeGlyphId) {
                selectGlyph(gid);
            }
        });
        cards.push(card);
    }
    strip.replaceChildren(...cards);
}
function renderStrokeListAndInspector() {
    const model = models[activeGlyphId];
    clampSelectionToModel();
    const totalAnchors = model.strokes.reduce((sum, s) => sum + s.points.length, 0);
    getEl('glyph-summary-stat').textContent =
        `${model.char} (${model.pinyin}) — ${model.strokes.length} strokes · ${totalAnchors} anchors`;
    // Global sliders
    const rScaleEl = getEl('radius-scale');
    rScaleEl.value = String(model.radiusScale);
    getEl('radius-scale-val').textContent = `${model.radiusScale.toFixed(2)}×`;
    const offXEl = getEl('offset-x');
    offXEl.value = String(model.offsetX);
    getEl('offset-x-val').textContent = `${model.offsetX.toFixed(2)}px`;
    const offYEl = getEl('offset-y');
    offYEl.value = String(model.offsetY);
    getEl('offset-y-val').textContent = `${model.offsetY.toFixed(2)}px`;
    // Stroke list items
    const listEl = getEl('stroke-list');
    const rows = [];
    for (let s = 0; s < model.strokes.length; s++) {
        const stroke = model.strokes[s];
        const color = STROKE_PALETTE[s % STROKE_PALETTE.length];
        const isSel = selectedAnchor?.strokeIdx === s;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'stroke-row' + (isSel ? ' active' : '');
        const swatch = document.createElement('span');
        swatch.className = 'stroke-swatch';
        swatch.style.backgroundColor = color;
        const nameSpan = document.createElement('span');
        nameSpan.className = 'stroke-row-name';
        nameSpan.textContent = `${s + 1}. ${stroke.name}`;
        const countSpan = document.createElement('span');
        countSpan.className = 'stroke-row-count';
        countSpan.textContent = `${stroke.points.length} pts`;
        btn.appendChild(swatch);
        btn.appendChild(nameSpan);
        btn.appendChild(countSpan);
        btn.addEventListener('click', () => {
            const pIdx = selectedAnchor?.strokeIdx === s
                ? Math.min(selectedAnchor.pointIdx, stroke.points.length - 1)
                : 0;
            selectedAnchor = { strokeIdx: s, pointIdx: pIdx };
            renderStrokeListAndInspector();
            editor?.render();
        });
        rows.push(btn);
    }
    listEl.replaceChildren(...rows);
    // Selected stroke & anchor inspector inputs
    const nameInput = getEl('stroke-name-input');
    const badgeEl = getEl('selected-anchor-badge');
    const xInput = getEl('anchor-x');
    const yInput = getEl('anchor-y');
    const rRange = getEl('anchor-r');
    const rNum = getEl('anchor-r-num');
    const delPtBtn = getEl('btn-delete-anchor');
    const delStrokeBtn = getEl('btn-delete-stroke');
    if (!selectedAnchor || !model.strokes[selectedAnchor.strokeIdx]) {
        nameInput.value = '';
        nameInput.disabled = true;
        badgeEl.textContent = 'No anchor selected';
        xInput.disabled = true;
        yInput.disabled = true;
        rRange.disabled = true;
        rNum.disabled = true;
        delPtBtn.disabled = true;
        delStrokeBtn.disabled = true;
        return;
    }
    const sIdx = selectedAnchor.strokeIdx;
    const pIdx = selectedAnchor.pointIdx;
    const stroke = model.strokes[sIdx];
    const pt = stroke.points[pIdx];
    nameInput.disabled = false;
    if (document.activeElement !== nameInput) {
        nameInput.value = stroke.name;
    }
    const role = pIdx === 0
        ? 'Start center-endpoint ■'
        : pIdx === stroke.points.length - 1
            ? 'End center-endpoint ■'
            : 'Interior curve anchor ●';
    badgeEl.textContent = `Stroke ${sIdx + 1} · Anchor #${pIdx} of ${stroke.points.length - 1} (${role})`;
    xInput.disabled = false;
    yInput.disabled = false;
    rRange.disabled = false;
    rNum.disabled = false;
    if (document.activeElement !== xInput)
        xInput.value = String(pt[0]);
    if (document.activeElement !== yInput)
        yInput.value = String(pt[1]);
    rRange.value = String(pt[2]);
    if (document.activeElement !== rNum)
        rNum.value = String(pt[2]);
    delPtBtn.disabled = stroke.points.length <= 2;
    delStrokeBtn.disabled = model.strokes.length <= 1;
}
function updateOutputsAndDiff() {
    const model = models[activeGlyphId];
    cachedPaths = buildCharacterPaths(model);
    const overlayGen = getEl('overlay-anchors-gen').checked;
    const metrics = updateComparisonPanels(model, cachedPaths, overlayGen);
    lastMetrics[activeGlyphId] = metrics;
    const rmseEl = getEl('rmse-display');
    const iouEl = getEl('iou-display');
    const balEl = getEl('ink-balance-display');
    if (metrics) {
        rmseEl.textContent = `RMSE: ${metrics.rmse.toFixed(2)}`;
        iouEl.textContent = `Overlap IoU: ${metrics.iouPct.toFixed(1)}%`;
        balEl.textContent =
            `Missing (red): ${metrics.missingInkPct.toFixed(1)}% · Extra (cyan): ${metrics.extraInkPct.toFixed(1)}%`;
    }
    else {
        rmseEl.textContent = 'RMSE: loading...';
        iouEl.textContent = 'Overlap IoU: --';
        balEl.textContent = 'Loading reference PNG...';
    }
    const opts = getExportOptions();
    const svgStr = buildCharacterSvg(model, opts);
    getEl('svg-output').value = svgStr;
    const jsonArea = getEl('json-output');
    if (document.activeElement !== jsonArea) {
        const cleanPayload = {
            id: model.id,
            char: model.char,
            radiusScale: model.radiusScale,
            offsetX: model.offsetX,
            offsetY: model.offsetY,
            strokes: model.strokes,
        };
        jsonArea.value = JSON.stringify(cleanPayload, null, 2);
    }
}
function refreshAll(statusHint) {
    updateOutputsAndDiff();
    renderStrokeListAndInspector();
    renderCharacterTabsAndStrip();
    editor?.render();
    if (statusHint) {
        setFeedback(statusHint);
    }
}
function selectGlyph(id) {
    if (editor && editor.getOptions().tool === EditorTool.AddStroke) {
        editor.cancelDraftStroke();
    }
    activeGlyphId = id;
    selectedAnchor = { strokeIdx: 0, pointIdx: 0 };
    updateUndoButtonState();
    refreshAll(`Editing ${models[id].char} (${models[id].pinyin} — ${models[id].meaning})`);
}
function syncToolButtons() {
    const isAdd = editor?.getOptions().tool === EditorTool.AddStroke;
    getEl('btn-tool-select').classList.toggle('active', !isAdd);
    getEl('btn-tool-add-stroke').classList.toggle('active', Boolean(isAdd));
    getEl('btn-finish-stroke').style.display = isAdd ? 'inline-block' : 'none';
    getEl('btn-cancel-stroke').style.display = isAdd ? 'inline-block' : 'none';
}
function insertMidpointAnchor() {
    const model = models[activeGlyphId];
    if (!selectedAnchor || !model.strokes[selectedAnchor.strokeIdx])
        return;
    const stroke = model.strokes[selectedAnchor.strokeIdx];
    const pts = stroke.points;
    const pIdx = selectedAnchor.pointIdx;
    // Split segment after pIdx (or before pIdx if at the last endpoint).
    const aIdx = pIdx < pts.length - 1 ? pIdx : pIdx - 1;
    const bIdx = aIdx + 1;
    const a = pts[aIdx];
    const b = pts[bIdx];
    const mid = [
        Math.round(((a[0] + b[0]) / 2) * 100) / 100,
        Math.round(((a[1] + b[1]) / 2) * 100) / 100,
        Math.round(((a[2] + b[2]) / 2) * 100) / 100,
    ];
    pushUndoSnapshot();
    pts.splice(bIdx, 0, mid);
    selectedAnchor = { strokeIdx: selectedAnchor.strokeIdx, pointIdx: bIdx };
    refreshAll(`Inserted anchor #${bIdx} on "${stroke.name}"`);
}
function deleteSelectedAnchor() {
    const model = models[activeGlyphId];
    if (!selectedAnchor || !model.strokes[selectedAnchor.strokeIdx])
        return;
    const stroke = model.strokes[selectedAnchor.strokeIdx];
    if (stroke.points.length <= 2) {
        setFeedback('Each stroke needs at least 2 anchor points (start & end)');
        return;
    }
    pushUndoSnapshot();
    const removedIdx = selectedAnchor.pointIdx;
    stroke.points.splice(removedIdx, 1);
    selectedAnchor = {
        strokeIdx: selectedAnchor.strokeIdx,
        pointIdx: Math.min(removedIdx, stroke.points.length - 1),
    };
    refreshAll(`Deleted anchor #${removedIdx} from "${stroke.name}"`);
}
function deleteSelectedStroke() {
    const model = models[activeGlyphId];
    if (!selectedAnchor || model.strokes.length <= 1) {
        setFeedback('Character must retain at least 1 stroke');
        return;
    }
    pushUndoSnapshot();
    const sIdx = selectedAnchor.strokeIdx;
    const removed = model.strokes.splice(sIdx, 1)[0];
    const nextStroke = Math.min(sIdx, model.strokes.length - 1);
    selectedAnchor = { strokeIdx: nextStroke, pointIdx: 0 };
    refreshAll(`Deleted stroke "${removed.name}"`);
}
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadSvgForGlyph(gid) {
    const svgStr = buildCharacterSvg(models[gid], getExportOptions());
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `iliqchuan-${gid}.svg`);
}
function downloadPngForActiveGlyph(sizePx) {
    const model = models[activeGlyphId];
    const svgStr = buildCharacterSvg(model, getExportOptions());
    const canvas = getEl('export-canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return;
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
        ctx.clearRect(0, 0, sizePx, sizePx);
        ctx.drawImage(img, 0, 0, sizePx, sizePx);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
            if (pngBlob) {
                downloadBlob(pngBlob, `iliqchuan-${model.id}-${sizePx}px.png`);
            }
        }, 'image/png');
    };
    img.onerror = () => {
        URL.revokeObjectURL(url);
        setFeedback('PNG export failed');
    };
    img.src = url;
}
async function runOptimizerUI(selectedStrokeOnly) {
    if (isOptimizing)
        return lastMetrics[activeGlyphId];
    const gid = activeGlyphId;
    const refAlpha = getGlyphReferenceAlpha(gid);
    if (!refAlpha) {
        setFeedback('Reference PNG not loaded yet');
        return null;
    }
    isOptimizing = true;
    stopOptimizeRequested = false;
    pushUndoSnapshot();
    const btnChar = getEl('btn-opt-char');
    const btnStroke = getEl('btn-opt-stroke');
    const btnStop = getEl('btn-opt-stop');
    btnChar.disabled = true;
    btnStroke.disabled = true;
    btnStop.style.display = 'inline-block';
    const strokeFilter = selectedStrokeOnly && selectedAnchor ? selectedAnchor.strokeIdx : null;
    try {
        const optimized = await optimizeCharacterModel(models[gid], refAlpha, strokeFilter, () => stopOptimizeRequested, (liveModel, prog) => {
            models[gid] = liveModel;
            if (gid === activeGlyphId) {
                refreshAll(`${prog.stageLabel} — RMSE ${prog.rmse.toFixed(2)} (${prog.evaluations} evals)`);
            }
        });
        models[gid] = optimized;
        refreshAll(stopOptimizeRequested
            ? 'Optimization stopped'
            : `Optimized ${optimized.char} — RMSE ${(lastMetrics[gid]?.rmse ?? 0).toFixed(2)}`);
    }
    finally {
        isOptimizing = false;
        stopOptimizeRequested = false;
        btnChar.disabled = false;
        btnStroke.disabled = false;
        btnStop.style.display = 'none';
    }
    return lastMetrics[gid];
}
function wireControls() {
    // Character tabs
    for (const gid of GLYPH_ORDER) {
        getEl(`tab-${gid}`).addEventListener('click', () => {
            selectGlyph(gid);
        });
    }
    // Global character adjustments
    const rScaleEl = getEl('radius-scale');
    rScaleEl.addEventListener('pointerdown', () => pushUndoSnapshot());
    rScaleEl.addEventListener('input', () => {
        const val = parseFloat(rScaleEl.value);
        if (Number.isFinite(val)) {
            models[activeGlyphId].radiusScale = Math.round(val * 1000) / 1000;
            refreshAll();
        }
    });
    const offXEl = getEl('offset-x');
    offXEl.addEventListener('pointerdown', () => pushUndoSnapshot());
    offXEl.addEventListener('input', () => {
        const val = parseFloat(offXEl.value);
        if (Number.isFinite(val)) {
            models[activeGlyphId].offsetX = Math.round(val * 100) / 100;
            refreshAll();
        }
    });
    const offYEl = getEl('offset-y');
    offYEl.addEventListener('pointerdown', () => pushUndoSnapshot());
    offYEl.addEventListener('input', () => {
        const val = parseFloat(offYEl.value);
        if (Number.isFinite(val)) {
            models[activeGlyphId].offsetY = Math.round(val * 100) / 100;
            refreshAll();
        }
    });
    // Editor display controls
    const backdropSel = getEl('backdrop-mode');
    backdropSel.addEventListener('change', () => {
        const val = backdropSel.value;
        const mode = val === EditorBackdrop.Reference
            ? EditorBackdrop.Reference
            : val === EditorBackdrop.Generated
                ? EditorBackdrop.Generated
                : EditorBackdrop.Overlay;
        editor?.setOptions({ backdrop: mode });
    });
    const showAnchorsChk = getEl('show-anchors');
    showAnchorsChk.addEventListener('change', () => {
        editor?.setOptions({ showAnchors: showAnchorsChk.checked });
    });
    const showRingsChk = getEl('show-radius-rings');
    showRingsChk.addEventListener('change', () => {
        editor?.setOptions({ showRadiusRings: showRingsChk.checked });
    });
    const showIndicesChk = getEl('show-indices');
    showIndicesChk.addEventListener('change', () => {
        editor?.setOptions({ showIndices: showIndicesChk.checked });
    });
    getEl('overlay-anchors-gen').addEventListener('change', () => {
        refreshAll();
    });
    // Editor tools
    getEl('btn-tool-select').addEventListener('click', () => {
        editor?.setOptions({ tool: EditorTool.Select });
        syncToolButtons();
        setFeedback('Select tool: drag anchors to move, Shift+drag to move stroke, Alt+drag to resize radius');
    });
    getEl('btn-tool-add-stroke').addEventListener('click', () => {
        editor?.setOptions({ tool: EditorTool.AddStroke });
        syncToolButtons();
        setFeedback('Click 2+ points along a new stroke centerline; press Enter or double-click to finish');
    });
    getEl('btn-finish-stroke').addEventListener('click', () => {
        editor?.finishDraftStroke();
        syncToolButtons();
    });
    getEl('btn-cancel-stroke').addEventListener('click', () => {
        editor?.cancelDraftStroke();
        syncToolButtons();
        setFeedback('Cancelled new stroke');
    });
    getEl('btn-undo').addEventListener('click', () => {
        performUndo();
    });
    // Selected stroke & anchor inspector
    const strokeNameInput = getEl('stroke-name-input');
    strokeNameInput.addEventListener('change', () => {
        const model = models[activeGlyphId];
        if (!selectedAnchor || !model.strokes[selectedAnchor.strokeIdx])
            return;
        const cleaned = strokeNameInput.value.replace(/[<>&"'`\x00-\x1F\x7F]/g, '').trim();
        if (cleaned.length > 0) {
            pushUndoSnapshot();
            model.strokes[selectedAnchor.strokeIdx].name = cleaned.slice(0, 60);
            refreshAll();
        }
    });
    const anchorX = getEl('anchor-x');
    const anchorY = getEl('anchor-y');
    const anchorR = getEl('anchor-r');
    const anchorRNum = getEl('anchor-r-num');
    const updateSelectedCoord = (coordIdx, rawVal, lo, hi) => {
        const val = parseFloat(rawVal);
        if (!Number.isFinite(val))
            return;
        const model = models[activeGlyphId];
        if (!selectedAnchor || !model.strokes[selectedAnchor.strokeIdx])
            return;
        const pt = model.strokes[selectedAnchor.strokeIdx].points[selectedAnchor.pointIdx];
        if (!pt)
            return;
        pt[coordIdx] = Math.round(Math.max(lo, Math.min(hi, val)) * 100) / 100;
        refreshAll();
    };
    anchorX.addEventListener('focus', () => pushUndoSnapshot());
    anchorX.addEventListener('input', () => updateSelectedCoord(0, anchorX.value, -35, 235));
    anchorY.addEventListener('focus', () => pushUndoSnapshot());
    anchorY.addEventListener('input', () => updateSelectedCoord(1, anchorY.value, -35, 235));
    anchorR.addEventListener('pointerdown', () => pushUndoSnapshot());
    anchorR.addEventListener('input', () => {
        anchorRNum.value = anchorR.value;
        updateSelectedCoord(2, anchorR.value, 0.4, 25);
    });
    anchorRNum.addEventListener('focus', () => pushUndoSnapshot());
    anchorRNum.addEventListener('input', () => {
        anchorR.value = anchorRNum.value;
        updateSelectedCoord(2, anchorRNum.value, 0.4, 25);
    });
    getEl('btn-insert-anchor').addEventListener('click', () => {
        insertMidpointAnchor();
    });
    getEl('btn-delete-anchor').addEventListener('click', () => {
        deleteSelectedAnchor();
    });
    getEl('btn-delete-stroke').addEventListener('click', () => {
        deleteSelectedStroke();
    });
    // Optimizer buttons
    getEl('btn-opt-char').addEventListener('click', () => {
        void runOptimizerUI(false);
    });
    getEl('btn-opt-stroke').addEventListener('click', () => {
        void runOptimizerUI(true);
    });
    getEl('btn-opt-stop').addEventListener('click', () => {
        stopOptimizeRequested = true;
    });
    // Custom reference upload & reset
    const refUpload = getEl('ref-upload');
    refUpload.addEventListener('change', () => {
        const file = refUpload.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const res = ev.target?.result;
            if (typeof res !== 'string')
                return;
            const img = new Image();
            img.onload = () => {
                setCustomGlyphReference(activeGlyphId, img);
                refreshAll(`Loaded custom reference image "${file.name}"`);
            };
            img.src = res;
        };
        reader.readAsDataURL(file);
    });
    getEl('btn-reset-ref').addEventListener('click', () => {
        const m = models[activeGlyphId];
        void loadGlyphReferenceAsset(activeGlyphId, m.refAsset).then(() => {
            refreshAll(`Restored extracted reference ${m.refAsset}`);
        });
    });
    // Export color options
    getEl('fg-color').addEventListener('input', () => refreshAll());
    getEl('bg-color').addEventListener('input', () => refreshAll());
    getEl('transparent-bg').addEventListener('change', () => refreshAll());
    // Persistence & Reset
    getEl('btn-save-local').addEventListener('click', () => {
        saveGlyphToStorage(activeGlyphId);
        setFeedback(`Saved ${models[activeGlyphId].char} to browser localStorage`);
    });
    getEl('btn-reset-default').addEventListener('click', () => {
        pushUndoSnapshot();
        clearGlyphStorage(activeGlyphId);
        models[activeGlyphId] = cloneCharacterModel(DEFAULT_CHARACTERS[activeGlyphId]);
        selectedAnchor = { strokeIdx: 0, pointIdx: 0 };
        refreshAll(`Reset ${models[activeGlyphId].char} to built-in default anchors`);
    });
    getEl('btn-reset-all').addEventListener('click', () => {
        pushUndoSnapshot();
        for (const gid of GLYPH_ORDER) {
            clearGlyphStorage(gid);
            models[gid] = cloneCharacterModel(DEFAULT_CHARACTERS[gid]);
        }
        selectedAnchor = { strokeIdx: 0, pointIdx: 0 };
        refreshAll('Reset all 3 characters (意, 力, 拳) to built-in defaults');
    });
    // SVG & PNG Downloads + Copy
    getEl('btn-copy-svg').addEventListener('click', () => {
        const svgStr = getEl('svg-output').value;
        void navigator.clipboard.writeText(svgStr).then(() => {
            setFeedback(`Copied ${models[activeGlyphId].char} SVG to clipboard`);
        });
    });
    getEl('btn-download-svg').addEventListener('click', () => {
        downloadSvgForGlyph(activeGlyphId);
        setFeedback(`Downloaded iliqchuan-${activeGlyphId}.svg`);
    });
    getEl('btn-download-all-svgs').addEventListener('click', () => {
        GLYPH_ORDER.forEach((gid, idx) => {
            setTimeout(() => downloadSvgForGlyph(gid), idx * 140);
        });
        setFeedback('Downloaded iliqchuan-yi.svg, iliqchuan-li.svg, and iliqchuan-quan.svg');
    });
    getEl('btn-download-png-200').addEventListener('click', () => {
        downloadPngForActiveGlyph(200);
    });
    getEl('btn-download-png-512').addEventListener('click', () => {
        downloadPngForActiveGlyph(512);
    });
    // Editable JSON import
    getEl('btn-apply-json').addEventListener('click', () => {
        const rawText = getEl('json-output').value;
        try {
            const parsed = JSON.parse(rawText);
            pushUndoSnapshot();
            models[activeGlyphId] = normalizeCharacterModel(parsed, DEFAULT_CHARACTERS[activeGlyphId]);
            clampSelectionToModel();
            refreshAll(`Applied JSON anchors to ${models[activeGlyphId].char}`);
        }
        catch {
            setFeedback('Invalid JSON syntax — check brackets and numbers');
        }
    });
    // Global keyboard shortcuts when not typing in an input/textarea
    window.addEventListener('keydown', (e) => {
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            performUndo();
            return;
        }
        if (editor?.getOptions().tool === EditorTool.AddStroke) {
            if (e.key === 'Enter') {
                e.preventDefault();
                editor.finishDraftStroke();
                syncToolButtons();
            }
            else if (e.key === 'Escape') {
                e.preventDefault();
                editor.cancelDraftStroke();
                syncToolButtons();
                setFeedback('Cancelled new stroke');
            }
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            deleteSelectedAnchor();
            return;
        }
        if (selectedAnchor &&
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '[', ']'].includes(e.key)) {
            const model = models[activeGlyphId];
            const stroke = model.strokes[selectedAnchor.strokeIdx];
            const pt = stroke?.points[selectedAnchor.pointIdx];
            if (!pt)
                return;
            e.preventDefault();
            pushUndoSnapshot();
            const step = e.shiftKey ? 0.1 : 0.5;
            if (e.key === 'ArrowLeft')
                pt[0] = Math.round((pt[0] - step) * 100) / 100;
            if (e.key === 'ArrowRight')
                pt[0] = Math.round((pt[0] + step) * 100) / 100;
            if (e.key === 'ArrowUp')
                pt[1] = Math.round((pt[1] - step) * 100) / 100;
            if (e.key === 'ArrowDown')
                pt[1] = Math.round((pt[1] + step) * 100) / 100;
            if (e.key === '[') {
                pt[2] = Math.round(Math.max(0.4, pt[2] - 0.2) * 100) / 100;
            }
            if (e.key === ']') {
                pt[2] = Math.round(Math.min(25, pt[2] + 0.2) * 100) / 100;
            }
            refreshAll();
        }
    });
}
async function init() {
    const editorCanvas = getEl('editor-canvas');
    editor = new GlyphCanvasEditor(editorCanvas, {
        backdrop: EditorBackdrop.Overlay,
        showAnchors: true,
        showRadiusRings: false,
        showIndices: true,
        tool: EditorTool.Select,
        defaultNewRadius: 5.0,
    }, {
        getModel: () => models[activeGlyphId],
        getPaths: () => cachedPaths,
        getSelected: () => selectedAnchor,
        setSelected: (sel) => {
            selectedAnchor = sel;
            renderStrokeListAndInspector();
        },
        pushUndoSnapshot,
        onModelMutated: (hint) => refreshAll(hint),
        onToolCompleted: () => syncToolButtons(),
    });
    wireControls();
    syncToolButtons();
    updateUndoButtonState();
    refreshAll('Loading extracted character references...');
    // Load all 3 extracted reference PNGs in parallel and compute initial metrics for all 3 cards.
    await Promise.all(GLYPH_ORDER.map(async (gid) => {
        try {
            await loadGlyphReferenceAsset(gid, DEFAULT_CHARACTERS[gid].refAsset);
            const paths = buildCharacterPaths(models[gid]);
            lastMetrics[gid] = updateComparisonPanels(models[gid], paths, false);
        }
        catch {
            // Individual error surfaced in status if active.
        }
    }));
    refreshAll('Ready — drag colored anchors to edit, double-click a stroke centerline to add an anchor, or click ⚡ Optimize Character');
    window.ilcGlyphMaker = {
        getActiveGlyph: () => activeGlyphId,
        selectGlyph,
        getModels: () => ({
            [GlyphId.Yi]: cloneCharacterModel(models[GlyphId.Yi]),
            [GlyphId.Li]: cloneCharacterModel(models[GlyphId.Li]),
            [GlyphId.Quan]: cloneCharacterModel(models[GlyphId.Quan]),
        }),
        getMetrics: (id) => lastMetrics[id ?? activeGlyphId],
        optimizeGlyph: async (id) => {
            selectGlyph(id);
            return runOptimizerUI(false);
        },
        optimizeAllGlyphs: async () => {
            const results = {
                [GlyphId.Yi]: null,
                [GlyphId.Li]: null,
                [GlyphId.Quan]: null,
            };
            for (const gid of GLYPH_ORDER) {
                selectGlyph(gid);
                results[gid] = await runOptimizerUI(false);
            }
            return results;
        },
    };
}
void init();
