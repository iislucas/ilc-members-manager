"use strict";
/* code-link-resolver.ts
 *
 * Generates local VS Code protocol URIs (vscode://file/...) and remote GitHub URLs.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeLinkResolver = void 0;
const path = __importStar(require("path"));
class CodeLinkResolver {
    repoRoot;
    gitHubBaseUrl;
    defaultBranch;
    constructor(options) {
        this.repoRoot = options?.repoRoot || path.resolve(__dirname, '../../../../');
        this.gitHubBaseUrl = options?.gitHubBaseUrl || 'https://github.com/iislucas/ilc-members-manager';
        this.defaultBranch = options?.defaultBranch || 'main';
    }
    /**
     * Generates a vscode://file/... URL for opening the file in local VS Code.
     */
    resolveVsCodeUrl(relativePath, line) {
        const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
        const absolutePath = path.resolve(this.repoRoot, cleanPath);
        const lineSuffix = line ? `:${line}` : '';
        return `vscode://file/${absolutePath}${lineSuffix}`;
    }
    /**
     * Generates a GitHub web URL for viewing the file in browser.
     */
    resolveGitHubUrl(relativePath, line, endLine) {
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
    resolveCodeLinks(relativePath, line, endLine) {
        return {
            filePath: relativePath,
            line,
            endLine,
            vsCodeUrl: this.resolveVsCodeUrl(relativePath, line),
            gitHubUrl: this.resolveGitHubUrl(relativePath, line, endLine),
        };
    }
}
exports.CodeLinkResolver = CodeLinkResolver;
//# sourceMappingURL=code-link-resolver.js.map