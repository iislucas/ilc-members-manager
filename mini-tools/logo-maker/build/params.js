/* Logo Maker – Parameter read/write and localStorage persistence.
 *
 * Reads LogoParams from DOM inputs, and saves/loads them to localStorage.
 */
import { $, numVal, strVal, boolVal, setInputVal } from './types.js';
// ---------------------------------------------------------------------------
// Parameter read
// ---------------------------------------------------------------------------
export function getParams() {
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
export function saveParams(updateFn) {
    const p = getParams();
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
        const btn = $('save-btn');
        btn.textContent = '✓ Saved!';
        setTimeout(() => (btn.textContent = 'Save Parameters'), 1500);
    }
    catch {
        // ignore
    }
}
export function loadParams(updateFn) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return;
        const p = JSON.parse(raw);
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
        setInputVal('nsewDecorationDistance', p.nsewDecorationDistance);
        setInputVal('diagonalDecorationDistance', p.diagonalDecorationDistance);
        setInputVal('nsewDecorationLength', p.nsewDecorationLength);
        setInputVal('nsewDecorationWidth', p.nsewDecorationWidth);
        setInputVal('nsewDecorationConcavity', p.nsewDecorationConcavity ?? 0.5);
        setInputVal('nsewDecorationThirdBumpDistance', p.nsewDecorationThirdBumpDistance ?? 12);
        setInputVal('nsewDecorationThirdBumpRadius', p.nsewDecorationThirdBumpRadius ?? 5);
        setInputVal('diagonalDecorationWidth', p.diagonalDecorationWidth);
        setInputVal('strokeColor', p.strokeColor);
        setInputVal('fillLight', p.fillLight);
        setInputVal('fillDark', p.fillDark);
        setInputVal('bgColor', p.bgColor);
        $('transparentBg').checked = p.transparentBg;
        updateFn();
    }
    catch {
        // ignore
    }
}
export function hasSavedParams() {
    return !!localStorage.getItem(STORAGE_KEY);
}
