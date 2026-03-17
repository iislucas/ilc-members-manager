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

    spokeLength: numVal('spokeLength'),
    spokeWidth: numVal('spokeWidth'),

    cardinalTipLength: numVal('cardinalTipLength'),
    cardinalTipWidth: numVal('cardinalTipWidth'),
    cardinalTipConcavity: numVal('cardinalTipConcavity'),
    diagonalTipLength: numVal('diagonalTipLength'),
    diagonalTipWidth: numVal('diagonalTipWidth'),

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

export function loadParams(updateFn: () => void): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as LogoParams;
    setInputVal('yinYangRadius', p.yinYangRadius);
    setInputVal('yinYangEyeRadius', p.yinYangEyeRadius);
    setInputVal('yinYangEyePosition', p.yinYangEyePosition * 100);
    setInputVal('yinYangRotation', p.yinYangRotation);
    setInputVal('innerRingWidth', p.innerRingWidth);
    setInputVal('innerRingGap', p.innerRingGap ?? 4);
    setInputVal('textBandWidth', p.textBandWidth);
    setInputVal('outerRingGap', p.outerRingGap ?? 2);
    setInputVal('outerRingWidth', p.outerRingWidth);
    setInputVal('textSizeUpper', p.textSizeUpper);
    setInputVal('textSizeLower', p.textSizeLower);
    setInputVal('textOffsetUpper', p.textOffsetUpper);
    setInputVal('textOffsetLower', p.textOffsetLower);
    setInputVal('textLetterSpacingLower', p.textLetterSpacingLower);
    setInputVal('spokeLength', p.spokeLength);
    setInputVal('spokeWidth', p.spokeWidth);
    setInputVal('cardinalTipLength', p.cardinalTipLength);
    setInputVal('cardinalTipWidth', p.cardinalTipWidth);
    setInputVal('cardinalTipConcavity', p.cardinalTipConcavity ?? 0.5);
    setInputVal('diagonalTipLength', p.diagonalTipLength);
    setInputVal('diagonalTipWidth', p.diagonalTipWidth);
    setInputVal('strokeColor', p.strokeColor);
    setInputVal('fillLight', p.fillLight);
    setInputVal('fillDark', p.fillDark);
    setInputVal('bgColor', p.bgColor);
    ($('transparentBg') as HTMLInputElement).checked = p.transparentBg;
    updateFn();
  } catch {
    // ignore
  }
}

export function hasSavedParams(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}
