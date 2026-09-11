/* docs/lib/scripts/generate-files-catalog.ts
 *
 * Scans 100% of tracked repository files, extracts exported symbols,
 * determines architectural layer, and generates docs/lib/src/catalog/files-catalog.ts.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ArchitecturalLayer, CodeFileEntry } from '../src/models/code-file';

const REPO_ROOT = path.resolve(__dirname, '../../../');
const OUTPUT_FILE = path.resolve(__dirname, '../src/catalog/files-catalog.ts');

function classifyLayer(filePath: string): ArchitecturalLayer {
  if (filePath.endsWith('.rules')) return ArchitecturalLayer.SecurityRules;
  if (filePath.startsWith('functions/src/data-model/')) return ArchitecturalLayer.DataModel;
  if (filePath.startsWith('functions/src/')) return ArchitecturalLayer.CloudFunction;
  if (filePath.startsWith('src/app/routing') || filePath.includes('navigation-tree')) return ArchitecturalLayer.ClientRouting;
  if (filePath.endsWith('.service.ts') || filePath.includes('searchable-set')) return ArchitecturalLayer.ClientCoreService;
  if (filePath.startsWith('src/app/') && (filePath.endsWith('.ts') || filePath.endsWith('.html') || filePath.endsWith('.scss'))) {
    return ArchitecturalLayer.ClientUIComponent;
  }
  if (filePath.startsWith('scripts/')) return ArchitecturalLayer.Script;
  if (filePath.startsWith('tests/') || filePath.endsWith('.spec.ts')) return ArchitecturalLayer.TestFixture;
  if (filePath.startsWith('docs/minitools/')) return ArchitecturalLayer.Tool;
  return ArchitecturalLayer.Configuration;
}

function extractSymbols(content: string): string[] {
  const symbols: string[] = [];
  const classMatches = content.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g);
  for (const m of classMatches) symbols.push(m[1]);
  const ifaceMatches = content.matchAll(/export\s+interface\s+([A-Za-z0-9_]+)/g);
  for (const m of ifaceMatches) symbols.push(m[1]);
  const enumMatches = content.matchAll(/export\s+enum\s+([A-Za-z0-9_]+)/g);
  for (const m of enumMatches) symbols.push(m[1]);
  const fnMatches = content.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g);
  for (const m of fnMatches) symbols.push(m[1]);
  const constMatches = content.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g);
  for (const m of constMatches) symbols.push(m[1]);
  return symbols.slice(0, 10);
}

function determineResponsibility(filePath: string, symbols: string[]): string {
  const base = path.basename(filePath);
  if (filePath.endsWith('.html')) return `HTML template for ${base.replace('.html', '')}`;
  if (filePath.endsWith('.scss')) return `SCSS stylesheet for ${base.replace('.scss', '')}`;
  if (filePath.endsWith('.spec.ts')) return `Unit and regression tests for ${base.replace('.spec.ts', '')}`;
  if (symbols.length > 0) return `Implements ${symbols.slice(0, 3).join(', ')}`;
  return `Provides implementation for ${base}`;
}

function associateDataTypes(filePath: string): string[] {
  const types: string[] = [];
  const lower = filePath.toLowerCase();
  if (lower.includes('grading')) types.push('grading');
  if (lower.includes('member')) types.push('member');
  if (lower.includes('event')) types.push('ilc-event');
  if (lower.includes('video') || lower.includes('vod')) types.push('video-item');
  if (lower.includes('order') || lower.includes('stripe')) types.push('order');
  if (lower.includes('school')) types.push('school');
  if (lower.includes('instructor')) types.push('instructor-profile');
  if (lower.includes('acl')) types.push('acl');
  return Array.from(new Set(types));
}

function main() {
  const rawFiles = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf-8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const entries: CodeFileEntry[] = [];

  for (const relPath of rawFiles) {
    const fullPath = path.resolve(REPO_ROOT, relPath);
    let symbols: string[] = [];
    if (relPath.endsWith('.ts') && fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        symbols = extractSymbols(content);
      } catch {}
    }

    const layer = classifyLayer(relPath);
    const responsibility = determineResponsibility(relPath, symbols);
    const relatedDataTypes = associateDataTypes(relPath);

    entries.push({
      path: relPath,
      layer,
      responsibility,
      keySymbols: symbols,
      relatedJourneys: [],
      relatedDataTypes,
      relatedStories: [],
      relatedFlows: [],
      relatedPatterns: [],
    });
  }

  const entriesCode = entries
    .map((e) => {
      return `  {
    path: ${JSON.stringify(e.path)},
    layer: ArchitecturalLayer.${e.layer},
    responsibility: ${JSON.stringify(e.responsibility)},
    keySymbols: ${JSON.stringify(e.keySymbols)},
    relatedJourneys: ${JSON.stringify(e.relatedJourneys)},
    relatedDataTypes: ${JSON.stringify(e.relatedDataTypes)},
    relatedStories: ${JSON.stringify(e.relatedStories)},
    relatedFlows: ${JSON.stringify(e.relatedFlows)},
    relatedPatterns: ${JSON.stringify(e.relatedPatterns)},
  }`;
    })
    .join(',\n');

  const fileContent = `/* files-catalog.ts
 *
 * Automatically cataloged index of 100% of repository tracked files (${entries.length} files).
 */

import { CodeFileEntry, ArchitecturalLayer } from '../models/code-file';

export const FILES_CATALOG: CodeFileEntry[] = [
${entriesCode}
];
`;

  fs.writeFileSync(OUTPUT_FILE, fileContent, 'utf-8');
  console.log(`Successfully generated files catalog for ${entries.length} files at ${OUTPUT_FILE}`);
}

main();
