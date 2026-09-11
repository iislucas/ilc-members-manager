export interface CodeLinks {
    filePath: string;
    line?: number;
    endLine?: number;
    vsCodeUrl: string;
    gitHubUrl: string;
}
export declare class CodeLinkResolver {
    private repoRoot;
    private gitHubBaseUrl;
    private defaultBranch;
    constructor(options?: {
        repoRoot?: string;
        gitHubBaseUrl?: string;
        defaultBranch?: string;
    });
    /**
     * Generates a vscode://file/... URL for opening the file in local VS Code.
     */
    resolveVsCodeUrl(relativePath: string, line?: number): string;
    /**
     * Generates a GitHub web URL for viewing the file in browser.
     */
    resolveGitHubUrl(relativePath: string, line?: number, endLine?: number): string;
    /**
     * Generates both VS Code and GitHub links for a given code location.
     */
    resolveCodeLinks(relativePath: string, line?: number, endLine?: number): CodeLinks;
}
//# sourceMappingURL=code-link-resolver.d.ts.map