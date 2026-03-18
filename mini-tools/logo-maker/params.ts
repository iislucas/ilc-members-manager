/* Logo Maker – Parameter read/write and localStorage persistence.
 *
 * Reads LogoParams from DOM inputs, and saves/loads them to localStorage.
 */

import { LogoParams, $, numVal, strVal, boolVal, setInputVal } from './types.js';

// ---------------------------------------------------------------------------
// Parameter read
// ---------------------------------------------------------------------------

export function getParams(): LogoParams {
  return {
    yinYangRadius: numVal('yinYangRadius'),
    yinYangEyeRadius: numVal('yinYangEyeRadius'),
    yinYangEyePosition: numVal('yinYangEyePosition') / 100,
    yinYangRotation: numVal('yinYangRotation'),

    innerRingWidth: numVal('innerRingWidth'),
    innerRingGap: numVal('innerRingGap'),
    textBandWidth: numVal('textBandWidth'),
    outerRingGap: numVal('outerRingGap'),
    outerRingWidth: numVal('outerRingWidth'),


    textSizeUpper: numVal('textSizeUpper'),
    textSizeLower: numVal('textSizeLower'),
    textOffsetUpper: numVal('textOffsetUpper'),
    textOffsetLower: numVal('textOffsetLower'),
    textLetterSpacingLower: numVal('textLetterSpacingLower'),

    nsewDecorationDistance: numVal('nsewDecorationDistance'),
    diagonalDecorationDistance: numVal('diagonalDecorationDistance'),

    nsewDecorationLength: numVal('nsewDecorationLength'),
    nsewDecorationWidth: numVal('nsewDecorationWidth'),
    nsewDecorationConcavity: numVal('nsewDecorationConcavity'),
    nsewDecorationThirdBumpDistance: numVal('nsewDecorationThirdBumpDistance'),
    nsewDecorationThirdBumpRadius: numVal('nsewDecorationThirdBumpRadius'),
    diagonalDecorationWidth: numVal('diagonalDecorationWidth'),

    strokeColor: strVal('strokeColor'),
    fillLight: strVal('fillLight'),
    fillDark: strVal('fillDark'),
    bgColor: strVal('bgColor'),
    transparentBg: boolVal('transparentBg'),
  };
}

// ---------------------------------------------------------------------------
// Local storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ilc-logo-params';

export function saveParams(updateFn: () => void): void {
  const p = getParams();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    const btn = $('save-btn');
    btn.textContent = '✓ Saved!';
    setTimeout(() => (btn.textContent = 'Save Parameters'), 1500);
  } catch {
    // ignore
  }
}

export function applyParams(p: Partial<LogoParams>): void {
  try {
    if (p.yinYangRadius !== undefined) setInputVal('yinYangRadius', p.yinYangRadius);
    if (p.yinYangEyeRadius !== undefined) setInputVal('yinYangEyeRadius', p.yinYangEyeRadius);
    if (p.yinYangEyePosition !== undefined) setInputVal('yinYangEyePosition', p.yinYangEyePosition * 100);
    if (p.yinYangRotation !== undefined) setInputVal('yinYangRotation', p.yinYangRotation);
    if (p.innerRingWidth !== undefined) setInputVal('innerRingWidth', p.innerRingWidth);
    if (p.innerRingGap !== undefined) setInputVal('innerRingGap', p.innerRingGap);
    if (p.textBandWidth !== undefined) setInputVal('textBandWidth', p.textBandWidth);
    if (p.outerRingGap !== undefined) setInputVal('outerRingGap', p.outerRingGap);
    if (p.outerRingWidth !== undefined) setInputVal('outerRingWidth', p.outerRingWidth);
    if (p.textSizeUpper !== undefined) setInputVal('textSizeUpper', p.textSizeUpper);
    if (p.textSizeLower !== undefined) setInputVal('textSizeLower', p.textSizeLower);
    if (p.textOffsetUpper !== undefined) setInputVal('textOffsetUpper', p.textOffsetUpper);
    if (p.textOffsetLower !== undefined) setInputVal('textOffsetLower', p.textOffsetLower);
    if (p.textLetterSpacingLower !== undefined) setInputVal('textLetterSpacingLower', p.textLetterSpacingLower);
    if (p.nsewDecorationDistance !== undefined) setInputVal('nsewDecorationDistance', p.nsewDecorationDistance);
    if (p.diagonalDecorationDistance !== undefined) setInputVal('diagonalDecorationDistance', p.diagonalDecorationDistance);
    if (p.nsewDecorationLength !== undefined) setInputVal('nsewDecorationLength', p.nsewDecorationLength);
    if (p.nsewDecorationWidth !== undefined) setInputVal('nsewDecorationWidth', p.nsewDecorationWidth);
    if (p.nsewDecorationConcavity !== undefined) setInputVal('nsewDecorationConcavity', p.nsewDecorationConcavity);
    if (p.nsewDecorationThirdBumpDistance !== undefined) setInputVal('nsewDecorationThirdBumpDistance', p.nsewDecorationThirdBumpDistance);
    if (p.nsewDecorationThirdBumpRadius !== undefined) setInputVal('nsewDecorationThirdBumpRadius', p.nsewDecorationThirdBumpRadius);
    if (p.diagonalDecorationWidth !== undefined) setInputVal('diagonalDecorationWidth', p.diagonalDecorationWidth);
    if (p.strokeColor !== undefined) setInputVal('strokeColor', p.strokeColor);
    if (p.fillLight !== undefined) setInputVal('fillLight', p.fillLight);
    if (p.fillDark !== undefined) setInputVal('fillDark', p.fillDark);
    if (p.bgColor !== undefined) setInputVal('bgColor', p.bgColor);
    if (p.transparentBg !== undefined) ($('transparentBg') as HTMLInputElement).checked = p.transparentBg;
  } catch {
    // ignore
  }
}

export function loadParams(updateFn: () => void): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as Partial<LogoParams>;
    applyParams(p);
    updateFn();
  } catch {
    // ignore
  }
}

export function hasSavedParams(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}
