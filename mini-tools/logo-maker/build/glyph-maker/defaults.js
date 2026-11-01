/* Default multi-anchor medial-axis stroke definitions and strict input validators
 * for the three I Liq Chuan calligraphic characters extracted from ILC-Logo-from-yen.jpeg.
 */
import { GlyphId } from './types.js';
export const STROKE_PALETTE = [
    '#ff595e',
    '#ffca3a',
    '#8ac926',
    '#38bdf8',
    '#c77dff',
    '#ff924c',
    '#00f5d4',
    '#f72585',
    '#aacc00',
    '#4cc9f0',
    '#ffd166',
    '#06d6a0',
    '#f15bb5',
    '#9ef01a',
];
export const GLYPH_ORDER = [
    GlyphId.Yi,
    GlyphId.Li,
    GlyphId.Quan,
];
export const DEFAULT_CHARACTERS = {
    [GlyphId.Yi]: {
        id: GlyphId.Yi,
        char: '意',
        pinyin: 'Yì',
        meaning: 'Mind / Intention',
        refAsset: 'assets/char-yi.png',
        radiusScale: 1.0,
        offsetX: 0.0,
        offsetY: 0.0,
        strokes: [
            {
                name: 'Top crown dot (立丶)',
                points: [
                    [99.5, 36.85, 5.63],
                    [100.8, 39.65, 7.85],
                    [100.5, 42.3, 9.51],
                ],
            },
            {
                name: 'Upper horizontal bar (立一)',
                points: [
                    [56.3, 51.6, 5.72],
                    [69.7, 50.25, 4.77],
                    [86.85, 48, 5.38],
                    [101.95, 46.5, 6.76],
                    [117.45, 48.5, 5.81],
                    [127.7, 48.95, 5.48],
                    [134.2, 49, 4.44],
                ],
            },
            {
                name: 'Upper left pillar (立丶)',
                points: [
                    [76.1, 50.5, 3.11],
                    [77.35, 60.1, 4.25],
                    [76.15, 69.7, 7.19],
                ],
            },
            {
                name: 'Upper right pillar (立丿)',
                points: [
                    [116.8, 53.9, 5.51],
                    [116.3, 59.5, 4.47],
                    [115.5, 64.55, 5.18],
                ],
            },
            {
                name: 'Long divider bar (立一)',
                points: [
                    [44.5, 76.35, 4.4],
                    [53.3, 74.25, 4.98],
                    [69.1, 72.6, 4.6],
                    [85.15, 68.7, 4.17],
                    [100.8, 67.95, 3.51],
                    [116, 69.5, 4.74],
                    [132.5, 71.5, 4.55],
                    [147.65, 73.75, 5.07],
                    [153.6, 72.95, 5.12],
                ],
            },
            {
                name: 'Sun left vertical (日丨)',
                points: [
                    [64.7, 92.65, 4.55],
                    [63.25, 100.15, 4.5],
                    [61.85, 106.9, 4.74],
                    [64.85, 113.65, 5.31],
                ],
            },
            {
                name: 'Sun top & right turn (日𠃍)',
                points: [
                    [73.75, 86.2, 4.48],
                    [84.65, 85.25, 4.72],
                    [100.3, 85, 4.48],
                    [115.15, 86.25, 5.15],
                    [125.4, 89.5, 5.76],
                    [129.65, 96.55, 5.15],
                    [132.75, 104.55, 5.9],
                    [130, 112.1, 6.19],
                ],
            },
            {
                name: 'Sun inner dash (日一)',
                points: [
                    [82.55, 98.5, 4.34],
                    [90.9, 97.8, 4.72],
                    [99.8, 97.75, 3.68],
                ],
            },
            {
                name: 'Sun bottom bar (日一)',
                points: [
                    [66.7, 115.45, 5.06],
                    [78.3, 115.1, 4.27],
                    [93.5, 115.4, 5.12],
                    [110.05, 114.9, 4.27],
                    [125.95, 114.95, 5.73],
                ],
            },
            {
                name: 'Heart left dot (心丶)',
                points: [
                    [53.2, 131, 3.59],
                    [50.9, 137.55, 5.92],
                    [49.15, 143.25, 6.86],
                    [48.6, 148.25, 5.25],
                ],
            },
            {
                name: 'Heart heel spur (心丿)',
                points: [
                    [78.75, 131.55, 7.01],
                    [74, 139.15, 5.96],
                    [69.9, 146.8, 4.54],
                ],
            },
            {
                name: 'Heart reclining arc (心乚)',
                points: [
                    [79.95, 132.95, 6.26],
                    [88.55, 139, 4.88],
                    [97.45, 145.5, 5.64],
                    [105.7, 152.6, 6.02],
                    [116.35, 157.05, 5.12],
                    [129.95, 158.95, 4.12],
                    [143.3, 162.1, 5.21],
                    [152, 161.05, 5.5],
                    [154.7, 159, 3.79],
                ],
            },
            {
                name: 'Heart center dot (心丶)',
                points: [
                    [110.2, 127.55, 5.18],
                    [112.75, 130.75, 6.03],
                    [112.85, 134.35, 5.46],
                ],
            },
            {
                name: 'Heart right dot (心丶)',
                points: [
                    [142.8, 132.4, 5.32],
                    [137.75, 136.15, 5.79],
                    [132.4, 138.85, 4.94],
                ],
            },
        ],
    },
    [GlyphId.Li]: {
        id: GlyphId.Li,
        char: '力',
        pinyin: 'Lì',
        meaning: 'Strength / Force',
        refAsset: 'assets/char-li.png',
        radiusScale: 1.0,
        offsetX: 0.0,
        offsetY: 0.0,
        strokes: [
            {
                name: 'Crossbar, shoulder & hook (横折钩)',
                points: [
                    [68.35, 68.05, 3.58],
                    [68.4, 72.25, 5.32],
                    [73.7, 78.35, 5.13],
                    [81.55, 79.9, 4.07],
                    [90.95, 76.35, 3.48],
                    [100.2, 73.85, 4.94],
                    [110.1, 72.55, 7.99],
                    [120.65, 74, 7.74],
                    [130.25, 75.2, 6],
                    [137.4, 79.5, 3.53],
                    [145.25, 82.9, 4.5],
                    [149.75, 86.25, 6.15],
                    [151.05, 94.05, 5.95],
                    [150.05, 103.35, 4.74],
                    [148.5, 112.3, 5.03],
                    [146.5, 120.75, 6.39],
                    [142.65, 130.3, 6.05],
                    [138.4, 139.6, 5.76],
                    [133.95, 147.35, 5.86],
                    [127.5, 151.85, 6.73],
                    [120.45, 152.1, 6.82],
                    [114.7, 146.85, 5.57],
                    [110.15, 141.35, 3.87],
                    [108, 137.85, 1.74],
                ],
            },
            {
                name: 'Upper vertical stem (撇上段)',
                points: [
                    [118.15, 42.2, 4.72],
                    [116.25, 46.95, 6.51],
                    [116.1, 55.45, 5.6],
                    [115.6, 64.5, 6.18],
                    [114.35, 73.75, 7.23],
                    [110.85, 80.45, 6.66],
                    [109.35, 84.7, 4.05],
                ],
            },
            {
                name: 'Lower-left diagonal sweep (撇下段)',
                points: [
                    [102.9, 100.95, 2.32],
                    [98.8, 106.2, 3.58],
                    [93.75, 112.7, 4.5],
                    [87.95, 119.95, 5.03],
                    [81.7, 127.95, 5.23],
                    [75.45, 135.95, 5.13],
                    [67.7, 143.45, 5.42],
                    [58.1, 149.45, 6.34],
                    [50.95, 152.95, 6.82],
                    [48.3, 156.55, 3.97],
                ],
            },
        ],
    },
    [GlyphId.Quan]: {
        id: GlyphId.Quan,
        char: '拳',
        pinyin: 'Quán',
        meaning: 'Fist / Martial Art',
        refAsset: 'assets/char-quan.png',
        radiusScale: 1.0,
        offsetX: 0.0,
        offsetY: 0.0,
        strokes: [
            {
                name: 'Top-left dot (龹丶)',
                points: [
                    [50.5, 42.3, 5.25],
                    [52.8, 45.7, 6.58],
                    [54.7, 49.1, 6.77],
                ],
            },
            {
                name: 'Top-right slash (龹㇒)',
                points: [
                    [128.25, 38.15, 5.67],
                    [125.15, 40, 7.14],
                    [120.95, 45.3, 5.62],
                    [118.55, 48.3, 3.2],
                ],
            },
            {
                name: 'Upper horizontal bar (龹一)',
                points: [
                    [56.4, 66.1, 4.3],
                    [70.75, 64.6, 3.7],
                    [86.3, 62.05, 4.93],
                    [101.25, 61.65, 5.02],
                    [117.05, 60.55, 4.08],
                    [130.1, 61.85, 4.45],
                ],
            },
            {
                name: 'Middle wide bar (龹一)',
                points: [
                    [44, 87.45, 5.35],
                    [56.05, 86.15, 3.84],
                    [72.5, 83.6, 5.02],
                    [87.5, 82.7, 4.6],
                    [106, 80.1, 3.98],
                    [125.65, 80, 4.16],
                    [140.7, 82.55, 5.02],
                    [144.8, 84.35, 4.27],
                ],
            },
            {
                name: 'Central-left sweep (龹丿)',
                points: [
                    [91.35, 39.65, 5.15],
                    [91.05, 46.25, 6.33],
                    [90.3, 55.3, 6.24],
                    [86, 65.8, 4.58],
                    [82.8, 79.35, 4.77],
                    [77.5, 89.55, 5.1],
                    [74.05, 99.6, 3.91],
                    [64.4, 107.55, 3.81],
                    [54.95, 116.8, 4.95],
                    [45.55, 123.8, 6.19],
                    [38, 127.85, 5.57],
                    [34.85, 129.65, 2.73],
                ],
            },
            {
                name: 'Right diagonal press (龹捺)',
                points: [
                    [104.8, 76.2, 5.42],
                    [111.4, 90.4, 5],
                    [116.65, 98.4, 4.33],
                    [127.75, 108.4, 3.86],
                    [139.5, 118.4, 4.76],
                    [151.65, 124.5, 5.61],
                    [160, 125, 4.62],
                    [163.6, 124.5, 2.77],
                ],
            },
            {
                name: 'Hand top crest slash (手㇒)',
                points: [
                    [107.9, 94.9, 5.64],
                    [96.15, 99.95, 4.83],
                    [83.1, 102.7, 4.12],
                    [73.8, 104.75, 3.32],
                ],
            },
            {
                name: 'Hand middle bar (手一)',
                points: [
                    [70.25, 121.55, 4.12],
                    [82.5, 119.7, 3.13],
                    [95.5, 118.7, 4.08],
                    [108.25, 118.95, 4.41],
                    [117.75, 118.45, 3.21],
                ],
            },
            {
                name: 'Hand lower bar (手一)',
                points: [
                    [58.2, 139.9, 5.74],
                    [72.15, 138.35, 3.53],
                    [86.05, 136.05, 3.34],
                    [99.65, 135.3, 5.38],
                    [115.2, 134.5, 5],
                    [128.7, 135.3, 4.85],
                    [134.3, 137.15, 3.67],
                ],
            },
            {
                name: 'Hand vertical spine & hook (手弯钩)',
                points: [
                    [93.35, 104.8, 1.91],
                    [95.6, 117, 3.86],
                    [98.2, 127.4, 5.56],
                    [98.45, 138.35, 5.47],
                    [98.7, 149.15, 3.95],
                    [98.45, 158.9, 4.81],
                    [92.7, 161.85, 5.28],
                    [83.1, 161.35, 5.33],
                    [76.75, 157.05, 3.95],
                ],
            },
        ],
    },
};
export function cloneCharacterModel(model) {
    return {
        ...model,
        strokes: model.strokes.map((s) => ({
            name: s.name,
            points: s.points.map((pt) => [pt[0], pt[1], pt[2]]),
        })),
    };
}
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export function sanitizeHexColor(raw, fallback) {
    const trimmed = raw.trim();
    return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : fallback;
}
function clampNum(v, min, max, fallback) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, v));
}
function sanitizeStrokeName(raw, index) {
    if (typeof raw !== 'string') {
        return `Stroke ${index + 1}`;
    }
    // Strip control characters and XML-sensitive brackets from stroke labels.
    const cleaned = raw.replace(/[<>&"'`\x00-\x1F\x7F]/g, '').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 60) : `Stroke ${index + 1}`;
}
// Validates untrusted JSON objects (from localStorage or user JSON edits) into safe CharacterModels.
export function normalizeCharacterModel(raw, fallback) {
    if (!raw || typeof raw !== 'object') {
        return cloneCharacterModel(fallback);
    }
    const obj = raw;
    const radiusScale = clampNum(obj['radiusScale'], 0.3, 2.5, fallback.radiusScale);
    const offsetX = clampNum(obj['offsetX'], -50, 50, fallback.offsetX);
    const offsetY = clampNum(obj['offsetY'], -50, 50, fallback.offsetY);
    const rawStrokes = Array.isArray(obj['strokes']) ? obj['strokes'] : null;
    if (!rawStrokes || rawStrokes.length === 0) {
        return {
            ...cloneCharacterModel(fallback),
            radiusScale,
            offsetX,
            offsetY,
        };
    }
    const strokes = [];
    const maxStrokes = Math.min(rawStrokes.length, 40);
    for (let i = 0; i < maxStrokes; i++) {
        const item = rawStrokes[i];
        if (!item || typeof item !== 'object')
            continue;
        const sObj = item;
        const rawPts = Array.isArray(sObj['points']) ? sObj['points'] : null;
        if (!rawPts || rawPts.length < 2)
            continue;
        const points = [];
        const maxPts = Math.min(rawPts.length, 60);
        for (let j = 0; j < maxPts; j++) {
            const p = rawPts[j];
            if (!Array.isArray(p) || p.length < 3)
                continue;
            const x = clampNum(p[0], -40, 240, 100);
            const y = clampNum(p[1], -40, 240, 100);
            const r = clampNum(p[2], 0.3, 30, 4.5);
            points.push([
                Math.round(x * 100) / 100,
                Math.round(y * 100) / 100,
                Math.round(r * 100) / 100,
            ]);
        }
        if (points.length >= 2) {
            strokes.push({
                name: sanitizeStrokeName(sObj['name'], strokes.length),
                points,
            });
        }
    }
    if (strokes.length === 0) {
        return cloneCharacterModel(fallback);
    }
    return {
        id: fallback.id,
        char: fallback.char,
        pinyin: fallback.pinyin,
        meaning: fallback.meaning,
        refAsset: fallback.refAsset,
        radiusScale: Math.round(radiusScale * 1000) / 1000,
        offsetX: Math.round(offsetX * 100) / 100,
        offsetY: Math.round(offsetY * 100) / 100,
        strokes,
    };
}
