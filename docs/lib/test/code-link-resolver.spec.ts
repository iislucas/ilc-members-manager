import { describe, it, expect } from 'vitest';
import { CodeLinkResolver } from '../src/resolvers/code-link-resolver';

describe('CodeLinkResolver', () => {
  const resolver = new CodeLinkResolver({
    repoRoot: '/fake/repo/root',
    gitHubBaseUrl: 'https://github.com/iislucas/ilc-members-manager',
    defaultBranch: 'main',
  });

  it('should generate vscode:// file URI without line', () => {
    const uri = resolver.resolveVsCodeUrl('src/app/data-manager.service.ts');
    expect(uri).toBe('vscode://file//fake/repo/root/src/app/data-manager.service.ts');
  });

  it('should generate vscode:// file URI with line number', () => {
    const uri = resolver.resolveVsCodeUrl('src/app/data-manager.service.ts', 142);
    expect(uri).toBe('vscode://file//fake/repo/root/src/app/data-manager.service.ts:142');
  });

  it('should generate GitHub URL without line anchor', () => {
    const url = resolver.resolveGitHubUrl('functions/src/on-grading-update.ts');
    expect(url).toBe('https://github.com/iislucas/ilc-members-manager/blob/main/functions/src/on-grading-update.ts');
  });

  it('should generate GitHub URL with single line anchor', () => {
    const url = resolver.resolveGitHubUrl('functions/src/on-grading-update.ts', 88);
    expect(url).toBe('https://github.com/iislucas/ilc-members-manager/blob/main/functions/src/on-grading-update.ts#L88');
  });

  it('should generate GitHub URL with range line anchor', () => {
    const url = resolver.resolveGitHubUrl('functions/src/on-grading-update.ts', 88, 120);
    expect(url).toBe('https://github.com/iislucas/ilc-members-manager/blob/main/functions/src/on-grading-update.ts#L88-L120');
  });

  it('should resolve both links simultaneously', () => {
    const links = resolver.resolveCodeLinks('firestore.rules', 25);
    expect(links.vsCodeUrl).toBe('vscode://file//fake/repo/root/firestore.rules:25');
    expect(links.gitHubUrl).toBe('https://github.com/iislucas/ilc-members-manager/blob/main/firestore.rules#L25');
  });
});
