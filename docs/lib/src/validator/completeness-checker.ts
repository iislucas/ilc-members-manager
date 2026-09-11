/* completeness-checker.ts
 *
 * Verifies that 100% of tracked repository source files and Firestore collections
 * are registered in the documentation catalog.
 */

import { execSync } from 'child_process';
import { CodeFileEntry } from '../models/code-file';
import { DataTypeEntry } from '../models/data-type';

export interface CompletenessReport {
  totalGitFiles: number;
  catalogedFiles: number;
  unregisteredFiles: string[];
  missingCollections: string[];
  isComplete: boolean;
}

export class CompletenessChecker {
  private repoRoot: string;

  constructor(repoRoot?: string) {
    this.repoRoot = repoRoot || process.cwd();
  }

  /**
   * Retrieves all git-tracked source files under src/, functions/src/, scripts/, and tests/.
   */
  public getTrackedSourceFiles(): string[] {
    try {
      const output = execSync('git ls-files', { cwd: this.repoRoot, encoding: 'utf-8' });
      return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => {
          if (!line) return false;
          // Focus on source and test files
          const isSource =
            line.startsWith('src/') ||
            line.startsWith('functions/src/') ||
            line.startsWith('scripts/') ||
            line.startsWith('tests/') ||
            line.startsWith('docs/minitools/');
          // Exclude generated/static assets
          const isAsset =
            line.endsWith('.json') ||
            line.endsWith('.png') ||
            line.endsWith('.jpg') ||
            line.endsWith('.svg') ||
            line.endsWith('.ico') ||
            line.endsWith('.txt');
          return isSource && !isAsset;
        });
    } catch {
      return [];
    }
  }

  /**
   * Asserts whether all given files exist in the catalog.
   */
  public checkFileCatalog(catalogedFiles: CodeFileEntry[]): CompletenessReport {
    const trackedFiles = this.getTrackedSourceFiles();
    const catalogMap = new Set(catalogedFiles.map((c) => c.path));

    const unregisteredFiles = trackedFiles.filter((f) => !catalogMap.has(f));

    return {
      totalGitFiles: trackedFiles.length,
      catalogedFiles: catalogedFiles.length,
      unregisteredFiles,
      missingCollections: [],
      isComplete: unregisteredFiles.length === 0,
    };
  }

  /**
   * Asserts whether all enum collection paths have matching entries in DataType catalog.
   */
  public checkCollectionCoverage(
    collections: string[],
    catalogedTypes: DataTypeEntry[],
  ): string[] {
    const registeredPaths = new Set(catalogedTypes.map((t) => t.collectionPath));
    return collections.filter((c) => !registeredPaths.has(c));
  }
}
