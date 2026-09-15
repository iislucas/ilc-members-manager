import { CodeFileEntry } from '../models/code-file';
import { DataTypeEntry } from '../models/data-type';
export interface CompletenessReport {
    totalGitFiles: number;
    catalogedFiles: number;
    unregisteredFiles: string[];
    missingCollections: string[];
    isComplete: boolean;
}
export declare class CompletenessChecker {
    private repoRoot;
    constructor(repoRoot?: string);
    /**
     * Retrieves all git-tracked source files under src/, functions/src/, scripts/, and tests/.
     */
    getTrackedSourceFiles(): string[];
    /**
     * Asserts whether all given files exist in the catalog.
     */
    checkFileCatalog(catalogedFiles: CodeFileEntry[]): CompletenessReport;
    /**
     * Asserts whether all enum collection paths have matching entries in DataType catalog.
     */
    checkCollectionCoverage(collections: string[], catalogedTypes: DataTypeEntry[]): string[];
}
//# sourceMappingURL=completeness-checker.d.ts.map