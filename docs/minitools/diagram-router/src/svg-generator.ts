/* docs/minitools/diagram-router/src/svg-generator.ts
 *
 * Generates clean SVG markup from routed paths.
 */

import { RoutedPath } from './types';
import { generateSvgPathWithRoundedCorners } from './geometry';

export interface SvgGenerationOptions {
  cornerRadius?: number;
}

export function renderPathsToSvg(
  paths: RoutedPath[],
  options: SvgGenerationOptions = {},
): string {
  const radius = options.cornerRadius ?? 5;
  const lines: string[] = [];

  for (const path of paths) {
    const d = generateSvgPathWithRoundedCorners(path.points, radius);
    const dashAttr = path.dashed ? ' stroke-dasharray="3"' : '';
    lines.push(`            <path id="${path.edgeId}" d="${d}" class="${path.cssClass}"${dashAttr} />`);
  }

  return lines.join('\n');
}
