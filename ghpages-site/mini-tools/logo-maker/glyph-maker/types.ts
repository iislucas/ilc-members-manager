/* Shared types and enums for the I Liq Chuan Chinese Character SVG Maker. */

export const VIEWBOX_SIZE = 200;

export enum GlyphId {
  Yi = 'yi',
  Li = 'li',
  Quan = 'quan',
}

export enum EditorBackdrop {
  Overlay = 'overlay',
  Reference = 'reference',
  Generated = 'generated',
}

export enum EditorTool {
  Select = 'select',
  AddStroke = 'add_stroke',
}

// [x, y, radius] in 200x200 character viewBox coordinates.
export type AnchorPoint = [number, number, number];

export interface StrokeDef {
  name: string;
  points: AnchorPoint[];
}

export interface CharacterModel {
  id: GlyphId;
  char: string;
  pinyin: string;
  meaning: string;
  refAsset: string;
  radiusScale: number;
  offsetX: number;
  offsetY: number;
  strokes: StrokeDef[];
}

export interface ExportOptions {
  fgColor: string;
  bgColor: string;
  transparentBg: boolean;
}

export interface DiffMetrics {
  rmse: number;
  iouPct: number;
  missingInkPct: number;
  extraInkPct: number;
}

export interface SelectedAnchor {
  strokeIdx: number;
  pointIdx: number;
}

export function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required DOM element #${id}`);
  }
  return el as T;
}
