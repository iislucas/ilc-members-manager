/* Logo Maker – Shared types and DOM helpers.
 *
 * Defines the LogoParams interface and small DOM utility functions
 * used across all modules of the logo maker tool.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogoParams {
  // Yin-yang
  yinYangRadius: number;
  yinYangEyeRadius: number;
  yinYangEyePosition: number; // 0..1, 0.5 = natural
  yinYangRotation: number; // degrees

  // Rings
  innerRingWidth: number;
  innerRingGap: number;
  textBandWidth: number;
  outerRingGap: number;
  outerRingWidth: number;


  // Text
  textSizeUpper: number;
  textSizeLower: number;
  textOffsetUpper: number; // fine-tune arc position
  textOffsetLower: number;
  textLetterSpacingLower: number;

  nsewDecorationDistance: number;

  // Tips
  nsewDecorationLength: number;
  nsewDecorationWidth: number;
  nsewDecorationConcavity: number; // 0 = straight sides, >1 = sharper point
  nsewDecorationThirdBumpDistance: number;
  nsewDecorationThirdBumpRadius: number;
  diagonalDecorationDistance: number;
  diagonalDecorationWidth: number;

  // Colors
  strokeColor: string;
  fillLight: string;
  fillDark: string;
  bgColor: string;
  transparentBg: boolean;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export const $ = (id: string) => document.getElementById(id)!;

export function numVal(id: string): number {
  return parseFloat(($(id) as HTMLInputElement).value);
}

export function strVal(id: string): string {
  return ($(id) as HTMLInputElement).value;
}

export function boolVal(id: string): boolean {
  return ($(id) as HTMLInputElement).checked;
}

export function setInputVal(id: string, val: number | string): void {
  const el = $(id) as HTMLInputElement;
  if (el) el.value = String(val);
}
