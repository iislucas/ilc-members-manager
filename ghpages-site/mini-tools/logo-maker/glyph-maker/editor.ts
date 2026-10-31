/* Interactive 2D Canvas Editor for viewing, dragging, inserting, resizing,
 * and deleting calligraphic stroke anchor points in 200x200 viewBox space.
 */

import { STROKE_PALETTE } from './defaults.js';
import { getGlyphReferenceAlpha } from './pixel-diff.js';
import {
  buildStrokeOutlinePath,
  findClosestSegmentOnModel,
  sampleCatmullRom3D,
} from './stroke-svg.js';
import {
  AnchorPoint,
  CharacterModel,
  EditorBackdrop,
  EditorTool,
  SelectedAnchor,
  VIEWBOX_SIZE,
} from './types.js';

export interface EditorViewOptions {
  backdrop: EditorBackdrop;
  showAnchors: boolean;
  showRadiusRings: boolean;
  showIndices: boolean;
  tool: EditorTool;
  defaultNewRadius: number;
}

export interface EditorCallbacks {
  getModel: () => CharacterModel;
  getPaths: () => readonly string[];
  getSelected: () => SelectedAnchor | null;
  setSelected: (sel: SelectedAnchor | null) => void;
  pushUndoSnapshot: () => void;
  onModelMutated: (statusHint?: string) => void;
  onToolCompleted: () => void;
}

type DragMode = 'move_point' | 'move_stroke' | 'scale_radius';

interface ActiveDrag {
  mode: DragMode;
  strokeIdx: number;
  pointIdx: number;
  startVx: number;
  startVy: number;
  origPoints: AnchorPoint[];
  origRadius: number;
}

const EDITOR_CSS_SIZE = 480;

export class GlyphCanvasEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cb: EditorCallbacks;
  private opts: EditorViewOptions;

  private hovered: SelectedAnchor | null = null;
  private drag: ActiveDrag | null = null;
  private draftStrokePoints: AnchorPoint[] = [];
  private cursorViewPos: [number, number] | null = null;

  // Cached 200x200 offscreen canvas for rendering the reference alpha tint smoothly.
  private readonly refTintCanvas: HTMLCanvasElement;
  private readonly refTintCtx: CanvasRenderingContext2D;

  constructor(
    canvas: HTMLCanvasElement,
    initialOpts: EditorViewOptions,
    callbacks: EditorCallbacks,
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D context for #editor-canvas');
    }
    this.ctx = ctx;
    this.opts = { ...initialOpts };
    this.cb = callbacks;

    this.refTintCanvas = document.createElement('canvas');
    this.refTintCanvas.width = VIEWBOX_SIZE;
    this.refTintCanvas.height = VIEWBOX_SIZE;
    const rCtx = this.refTintCanvas.getContext('2d');
    if (!rCtx) {
      throw new Error('Could not initialize offscreen reference tint canvas');
    }
    this.refTintCtx = rCtx;

    this.bindEvents();
  }

  public setOptions(patch: Partial<EditorViewOptions>): void {
    const prevTool = this.opts.tool;
    this.opts = { ...this.opts, ...patch };
    if (prevTool === EditorTool.AddStroke && this.opts.tool !== EditorTool.AddStroke) {
      this.draftStrokePoints = [];
    }
    this.canvas.style.cursor =
      this.opts.tool === EditorTool.AddStroke ? 'crosshair' : 'default';
    this.render();
  }

  public getOptions(): EditorViewOptions {
    return { ...this.opts };
  }

  public getDraftPointCount(): number {
    return this.draftStrokePoints.length;
  }

  public finishDraftStroke(): boolean {
    if (this.draftStrokePoints.length < 2) {
      this.draftStrokePoints = [];
      this.opts.tool = EditorTool.Select;
      this.canvas.style.cursor = 'default';
      this.render();
      return false;
    }
    const model = this.cb.getModel();
    this.cb.pushUndoSnapshot();
    const newIdx = model.strokes.length;
    model.strokes.push({
      name: `Custom stroke ${newIdx + 1}`,
      points: this.draftStrokePoints.map((p): AnchorPoint => [p[0], p[1], p[2]]),
    });
    const lastPt = this.draftStrokePoints.length - 1;
    this.draftStrokePoints = [];
    this.opts.tool = EditorTool.Select;
    this.canvas.style.cursor = 'default';
    this.cb.setSelected({ strokeIdx: newIdx, pointIdx: lastPt });
    this.cb.onToolCompleted();
    this.cb.onModelMutated(`Added stroke #${newIdx + 1}`);
    return true;
  }

  public cancelDraftStroke(): void {
    this.draftStrokePoints = [];
    this.opts.tool = EditorTool.Select;
    this.canvas.style.cursor = 'default';
    this.cb.onToolCompleted();
    this.render();
  }

  private eventToViewCoords(e: MouseEvent | PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = VIEWBOX_SIZE / Math.max(1, rect.width);
    const scaleY = VIEWBOX_SIZE / Math.max(1, rect.height);
    const vx = (e.clientX - rect.left) * scaleX;
    const vy = (e.clientY - rect.top) * scaleY;
    return [vx, vy];
  }

  private hitTestAnchor(vx: number, vy: number): SelectedAnchor | null {
    const model = this.cb.getModel();
    const selected = this.cb.getSelected();
    const hitRadius = 4.6; // in 200x200 viewBox units (~12 CSS px on 520px canvas)
    let best: SelectedAnchor | null = null;
    let bestDist = hitRadius;

    // Prioritize currently selected stroke first when handles overlap.
    const order: number[] = [];
    if (selected && selected.strokeIdx < model.strokes.length) {
      order.push(selected.strokeIdx);
    }
    for (let s = model.strokes.length - 1; s >= 0; s--) {
      if (!order.includes(s)) order.push(s);
    }

    for (const s of order) {
      const pts = model.strokes[s].points;
      for (let p = 0; p < pts.length; p++) {
        const ax = pts[p][0] + model.offsetX;
        const ay = pts[p][1] + model.offsetY;
        const d = Math.hypot(vx - ax, vy - ay);
        if (d < bestDist) {
          bestDist = d;
          best = { strokeIdx: s, pointIdx: p };
        }
      }
    }
    return best;
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button === 2) {
        return;
      }
      const [vx, vy] = this.eventToViewCoords(e);
      const model = this.cb.getModel();

      if (this.opts.tool === EditorTool.AddStroke) {
        const rx = Math.round((vx - model.offsetX) * 100) / 100;
        const ry = Math.round((vy - model.offsetY) * 100) / 100;
        const rr = Math.round(this.opts.defaultNewRadius * 100) / 100;
        // Avoid duplicate point on double-click finish.
        const prev = this.draftStrokePoints[this.draftStrokePoints.length - 1];
        if (!prev || Math.hypot(prev[0] - rx, prev[1] - ry) > 1.2) {
          this.draftStrokePoints.push([rx, ry, rr]);
        }
        this.render();
        return;
      }

      const hit = this.hitTestAnchor(vx, vy);
      if (hit) {
        this.cb.setSelected(hit);
        this.cb.pushUndoSnapshot();
        const stroke = model.strokes[hit.strokeIdx];
        const mode: DragMode = e.altKey
          ? 'scale_radius'
          : e.shiftKey
            ? 'move_stroke'
            : 'move_point';
        this.drag = {
          mode,
          strokeIdx: hit.strokeIdx,
          pointIdx: hit.pointIdx,
          startVx: vx,
          startVy: vy,
          origPoints: stroke.points.map((p): AnchorPoint => [p[0], p[1], p[2]]),
          origRadius: stroke.points[hit.pointIdx][2],
        };
        this.canvas.setPointerCapture(e.pointerId);
        this.render();
        return;
      }

      // Otherwise check if user clicked near a stroke centerline to select that stroke.
      const segHit = findClosestSegmentOnModel(model, vx, vy);
      if (segHit && segHit.distance < 7.0) {
        const strokePts = model.strokes[segHit.strokeIdx].points;
        let nearestIdx = 0;
        let nearestD = Infinity;
        for (let i = 0; i < strokePts.length; i++) {
          const d = Math.hypot(
            vx - (strokePts[i][0] + model.offsetX),
            vy - (strokePts[i][1] + model.offsetY),
          );
          if (d < nearestD) {
            nearestD = d;
            nearestIdx = i;
          }
        }
        this.cb.setSelected({ strokeIdx: segHit.strokeIdx, pointIdx: nearestIdx });
        this.render();
      }
    });

    this.canvas.addEventListener('pointermove', (e: PointerEvent) => {
      const [vx, vy] = this.eventToViewCoords(e);
      this.cursorViewPos = [vx, vy];

      if (this.opts.tool === EditorTool.AddStroke) {
        this.render();
        return;
      }

      if (this.drag) {
        const model = this.cb.getModel();
        const stroke = model.strokes[this.drag.strokeIdx];
        if (!stroke) return;

        const dx = vx - this.drag.startVx;
        const dy = vy - this.drag.startVy;

        if (this.drag.mode === 'move_point') {
          const orig = this.drag.origPoints[this.drag.pointIdx];
          stroke.points[this.drag.pointIdx][0] =
            Math.round(Math.max(-35, Math.min(235, orig[0] + dx)) * 100) / 100;
          stroke.points[this.drag.pointIdx][1] =
            Math.round(Math.max(-35, Math.min(235, orig[1] + dy)) * 100) / 100;
          this.cb.onModelMutated();
        } else if (this.drag.mode === 'move_stroke') {
          for (let i = 0; i < stroke.points.length; i++) {
            const orig = this.drag.origPoints[i];
            stroke.points[i][0] =
              Math.round(Math.max(-35, Math.min(235, orig[0] + dx)) * 100) / 100;
            stroke.points[i][1] =
              Math.round(Math.max(-35, Math.min(235, orig[1] + dy)) * 100) / 100;
          }
          this.cb.onModelMutated();
        } else if (this.drag.mode === 'scale_radius') {
          const deltaR = (dx - dy) * 0.25;
          stroke.points[this.drag.pointIdx][2] =
            Math.round(
              Math.max(0.4, Math.min(25, this.drag.origRadius + deltaR)) * 100,
            ) / 100;
          this.cb.onModelMutated();
        }
        return;
      }

      const prevHover = this.hovered;
      this.hovered = this.hitTestAnchor(vx, vy);
      this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
      if (
        prevHover?.strokeIdx !== this.hovered?.strokeIdx ||
        prevHover?.pointIdx !== this.hovered?.pointIdx
      ) {
        this.render();
      }
    });

    const endDrag = (e: PointerEvent): void => {
      if (this.drag) {
        if (this.canvas.hasPointerCapture(e.pointerId)) {
          this.canvas.releasePointerCapture(e.pointerId);
        }
        this.drag = null;
        this.canvas.style.cursor = this.hovered ? 'grab' : 'default';
        this.render();
      }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    this.canvas.addEventListener('pointerleave', () => {
      this.cursorViewPos = null;
      if (!this.drag && this.hovered) {
        this.hovered = null;
        this.render();
      } else if (this.opts.tool === EditorTool.AddStroke) {
        this.render();
      }
    });

    // Double-click: finish new stroke if in AddStroke mode, or insert anchor on closest centerline.
    this.canvas.addEventListener('dblclick', (e: MouseEvent) => {
      e.preventDefault();
      if (this.opts.tool === EditorTool.AddStroke) {
        this.finishDraftStroke();
        return;
      }

      const [vx, vy] = this.eventToViewCoords(e);
      const model = this.cb.getModel();
      const segHit = findClosestSegmentOnModel(model, vx, vy);
      if (segHit && segHit.distance < 10.0) {
        this.cb.pushUndoSnapshot();
        const stroke = model.strokes[segHit.strokeIdx];
        stroke.points.splice(segHit.insertIndex, 0, segHit.point);
        this.cb.setSelected({
          strokeIdx: segHit.strokeIdx,
          pointIdx: segHit.insertIndex,
        });
        this.cb.onModelMutated(
          `Inserted anchor #${segHit.insertIndex + 1} on "${stroke.name}"`,
        );
      }
    });

    // Right-click on an anchor point deletes it (keeping >= 2 points per stroke).
    this.canvas.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      if (this.opts.tool === EditorTool.AddStroke) {
        this.cancelDraftStroke();
        return;
      }
      const [vx, vy] = this.eventToViewCoords(e);
      const hit = this.hitTestAnchor(vx, vy);
      if (!hit) return;

      const model = this.cb.getModel();
      const stroke = model.strokes[hit.strokeIdx];
      if (!stroke || stroke.points.length <= 2) {
        this.cb.onModelMutated('Each stroke requires at least 2 anchor points');
        return;
      }
      this.cb.pushUndoSnapshot();
      stroke.points.splice(hit.pointIdx, 1);
      const nextPtIdx = Math.min(hit.pointIdx, stroke.points.length - 1);
      this.cb.setSelected({ strokeIdx: hit.strokeIdx, pointIdx: nextPtIdx });
      this.cb.onModelMutated(`Removed anchor from "${stroke.name}"`);
    });

    // Alt + wheel over hovered or selected anchor adjusts brush radius finely.
    this.canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!e.altKey) return;
        const target = this.hovered ?? this.cb.getSelected();
        if (!target) return;
        e.preventDefault();
        const model = this.cb.getModel();
        const stroke = model.strokes[target.strokeIdx];
        if (!stroke || !stroke.points[target.pointIdx]) return;
        this.cb.pushUndoSnapshot();
        const step = e.deltaY < 0 ? 0.25 : -0.25;
        stroke.points[target.pointIdx][2] =
          Math.round(
            Math.max(0.4, Math.min(25, stroke.points[target.pointIdx][2] + step)) *
              100,
          ) / 100;
        this.cb.onModelMutated();
      },
      { passive: false },
    );
  }

  private drawReferenceLayer(
    ctx: CanvasRenderingContext2D,
    scale: number,
    tintMode: 'amber' | 'ivory',
  ): void {
    const model = this.cb.getModel();
    const refAlpha = getGlyphReferenceAlpha(model.id);
    if (!refAlpha) return;

    const imgData = this.refTintCtx.createImageData(VIEWBOX_SIZE, VIEWBOX_SIZE);
    const d = imgData.data;
    const total = VIEWBOX_SIZE * VIEWBOX_SIZE;

    for (let i = 0; i < total; i++) {
      const a = refAlpha[i];
      const idx = i * 4;
      if (tintMode === 'amber') {
        d[idx] = 251;
        d[idx + 1] = 191;
        d[idx + 2] = 36;
        d[idx + 3] = Math.round(a * 0.56);
      } else {
        d[idx] = 248;
        d[idx + 1] = 250;
        d[idx + 2] = 252;
        d[idx + 3] = a;
      }
    }
    this.refTintCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      this.refTintCanvas,
      0,
      0,
      VIEWBOX_SIZE * scale,
      VIEWBOX_SIZE * scale,
    );
    ctx.restore();
  }

  public render(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const targetPx = Math.round(EDITOR_CSS_SIZE * dpr);
    if (this.canvas.width !== targetPx || this.canvas.height !== targetPx) {
      this.canvas.width = targetPx;
      this.canvas.height = targetPx;
    }

    const ctx = this.ctx;
    const scale = targetPx / VIEWBOX_SIZE;
    const model = this.cb.getModel();
    const paths = this.cb.getPaths();
    const selected = this.cb.getSelected();

    ctx.save();
    ctx.clearRect(0, 0, targetPx, targetPx);

    // 1. Dark studio canvas backdrop + subtle 20-unit coordinate grid.
    ctx.fillStyle = '#0b1325';
    ctx.fillRect(0, 0, targetPx, targetPx);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    ctx.lineWidth = Math.max(1, dpr * 0.75);
    for (let g = 20; g < VIEWBOX_SIZE; g += 20) {
      const pos = g * scale;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, targetPx);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(targetPx, pos);
      ctx.stroke();
    }

    // Center crosshair at (100, 100).
    ctx.strokeStyle = 'rgba(233, 69, 96, 0.2)';
    ctx.beginPath();
    ctx.moveTo(100 * scale, 0);
    ctx.lineTo(100 * scale, targetPx);
    ctx.moveTo(0, 100 * scale);
    ctx.lineTo(targetPx, 100 * scale);
    ctx.stroke();

    // 2. Backdrop layers (Reference / Overlay / Generated).
    if (this.opts.backdrop === EditorBackdrop.Reference) {
      this.drawReferenceLayer(ctx, scale, 'ivory');
    } else if (this.opts.backdrop === EditorBackdrop.Overlay) {
      this.drawReferenceLayer(ctx, scale, 'amber');
      ctx.save();
      ctx.scale(scale, scale);
      for (let s = 0; s < paths.length; s++) {
        const d = paths[s];
        if (!d) continue;
        const p2d = new Path2D(d);
        const isSelStroke = selected?.strokeIdx === s;
        ctx.fillStyle = isSelStroke
          ? 'rgba(56, 189, 248, 0.48)'
          : 'rgba(148, 226, 255, 0.30)';
        ctx.fill(p2d);
        ctx.strokeStyle = isSelStroke
          ? 'rgba(125, 211, 252, 0.92)'
          : 'rgba(125, 211, 252, 0.42)';
        ctx.lineWidth = isSelStroke ? 0.65 : 0.4;
        ctx.stroke(p2d);
      }
      ctx.restore();
    } else {
      ctx.save();
      ctx.scale(scale, scale);
      ctx.fillStyle = '#f8fafc';
      for (const d of paths) {
        if (!d) continue;
        ctx.fill(new Path2D(d));
      }
      ctx.restore();
    }

    // 3. Colored stroke centerlines, radius rings, and anchor handles.
    if (this.opts.showAnchors) {
      for (let s = 0; s < model.strokes.length; s++) {
        const stroke = model.strokes[s];
        const color = STROKE_PALETTE[s % STROKE_PALETTE.length];
        const isSelStroke = selected?.strokeIdx === s;

        const sampled = sampleCatmullRom3D(
          stroke.points,
          model.radiusScale,
          model.offsetX,
          model.offsetY,
          1.6,
        );

        if (sampled.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(sampled[0].x * scale, sampled[0].y * scale);
          for (let k = 1; k < sampled.length; k++) {
            ctx.lineTo(sampled[k].x * scale, sampled[k].y * scale);
          }
          ctx.strokeStyle = color;
          ctx.globalAlpha = isSelStroke ? 1.0 : 0.78;
          ctx.lineWidth = (isSelStroke ? 2.6 : 1.6) * dpr;
          ctx.stroke();
          ctx.globalAlpha = 1.0;
        }

        // Draw anchor points and optional brush radius circles.
        for (let p = 0; p < stroke.points.length; p++) {
          const ax = (stroke.points[p][0] + model.offsetX) * scale;
          const ay = (stroke.points[p][1] + model.offsetY) * scale;
          const ar = stroke.points[p][2] * model.radiusScale * scale;
          const isSelPt = isSelStroke && selected?.pointIdx === p;
          const isHovPt =
            this.hovered?.strokeIdx === s && this.hovered?.pointIdx === p;
          const isEndpoint = p === 0 || p === stroke.points.length - 1;

          if (this.opts.showRadiusRings || isSelStroke || isHovPt) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(ax, ay, Math.max(2, ar), 0, Math.PI * 2);
            ctx.setLineDash([3 * dpr, 3 * dpr]);
            ctx.strokeStyle = color;
            ctx.globalAlpha = isSelPt || isHovPt ? 0.85 : 0.32;
            ctx.lineWidth = (isSelPt ? 1.5 : 1.0) * dpr;
            ctx.stroke();
            ctx.restore();
          }

          if (isSelPt || isHovPt) {
            ctx.beginPath();
            ctx.arc(ax, ay, (isSelPt ? 8.5 : 7.0) * dpr, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.0 * dpr;
            ctx.stroke();
          }

          if (isEndpoint) {
            // Square handle for stroke start/end center-endpoints.
            const half = (isSelPt ? 5.2 : 4.2) * dpr;
            ctx.fillStyle = color;
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 1.5 * dpr;
            ctx.fillRect(ax - half, ay - half, half * 2, half * 2);
            ctx.strokeRect(ax - half, ay - half, half * 2, half * 2);
          } else {
            // Circular handle for interior curve/thickness anchors.
            const rad = (isSelPt ? 5.2 : 4.0) * dpr;
            ctx.beginPath();
            ctx.arc(ax, ay, rad, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 1.5 * dpr;
            ctx.stroke();
          }

          if (this.opts.showIndices && (isSelStroke || this.opts.showIndices)) {
            if (isSelStroke) {
              ctx.font = `600 ${Math.round(10 * dpr)}px "SF Mono", monospace`;
              ctx.fillStyle = '#ffffff';
              ctx.fillText(String(p), ax + 6 * dpr, ay - 6 * dpr);
            }
          }
        }
      }
    }

    // 4. Draft new-stroke preview when in AddStroke mode.
    if (this.opts.tool === EditorTool.AddStroke && this.draftStrokePoints.length > 0) {
      const previewPts: AnchorPoint[] = this.draftStrokePoints.map(
        (pt): AnchorPoint => [pt[0], pt[1], pt[2]],
      );
      if (this.cursorViewPos) {
        const cx = this.cursorViewPos[0] - model.offsetX;
        const cy = this.cursorViewPos[1] - model.offsetY;
        const last = previewPts[previewPts.length - 1];
        if (Math.hypot(cx - last[0], cy - last[1]) > 1.0) {
          previewPts.push([cx, cy, this.opts.defaultNewRadius]);
        }
      }

      if (previewPts.length >= 2) {
        const draftPath = buildStrokeOutlinePath(
          previewPts,
          model.radiusScale,
          model.offsetX,
          model.offsetY,
        );
        if (draftPath) {
          ctx.save();
          ctx.scale(scale, scale);
          const p2d = new Path2D(draftPath);
          ctx.fillStyle = 'rgba(16, 185, 129, 0.38)';
          ctx.fill(p2d);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 0.6;
          ctx.stroke(p2d);
          ctx.restore();
        }
      }

      for (const pt of this.draftStrokePoints) {
        const ax = (pt[0] + model.offsetX) * scale;
        const ay = (pt[1] + model.offsetY) * scale;
        ctx.beginPath();
        ctx.arc(ax, ay, 5 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}
