/* code-link-resolver.ts
 *
 * Generates local VS Code protocol URIs (vscode://file/...) and remote GitHub URLs.
 */

export interface CodeLinks {
  filePath: string;
  line?: number;
  endLine?: number;
  vsCodeUrl: string;
  gitHubUrl: string;
}

export class CodeLinkResolver {
  private repoRoot: string;
  private gitHubBaseUrl: string;
  private defaultBranch: string;

  constructor(options?: {
    repoRoot?: string;
    gitHubBaseUrl?: string;
    defaultBranch?: string;
  }) {
    this.repoRoot = options?.repoRoot || '/Users/ldixon/code/zxd/ilc-members-manager';
    this.gitHubBaseUrl = options?.gitHubBaseUrl || 'https://github.com/iislucas/ilc-members-manager';
    this.defaultBranch = options?.defaultBranch || 'main';
  }

  /**
   * Generates a vscode://file/... URL for opening the file in local VS Code.
   */
  public resolveVsCodeUrl(relativePath: string, line?: number): string {
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    const cleanRepo = this.repoRoot.endsWith('/') ? this.repoRoot.slice(0, -1) : this.repoRoot;
    const absolutePath = `${cleanRepo}/${cleanPath}`;
    const lineSuffix = line ? `:${line}` : '';
    return `vscode://file/${absolutePath}${lineSuffix}`;
  }

  /**
   * Generates a GitHub web URL for viewing the file in browser.
   */
  public resolveGitHubUrl(relativePath: string, line?: number, endLine?: number): string {
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    let anchor = '';
    if (line) {
      anchor = endLine && endLine > line ? `#L${line}-L${endLine}` : `#L${line}`;
    }
    return `${this.gitHubBaseUrl}/blob/${this.defaultBranch}/${cleanPath}${anchor}`;
  }

  /**
   * Generates both VS Code and GitHub links for a given code location.
   */
  public resolveCodeLinks(relativePath: string, line?: number, endLine?: number): CodeLinks {
    return {
      filePath: relativePath,
      line,
      endLine,
      vsCodeUrl: this.resolveVsCodeUrl(relativePath, line),
      gitHubUrl: this.resolveGitHubUrl(relativePath, line, endLine),
    };
  }
}
