/* markdown-config.ts
 *
 * Central configuration for marked parser with support for GFM, breaks,
 * and custom list rendering to distinguish '-' bullets from '*' bullets.
 */

import { marked } from 'marked';

let isConfigured = false;

export function configureMarked(): void {
  if (isConfigured) return;
  isConfigured = true;

  marked.use({
    breaks: true,
    gfm: true,
    renderer: {
      list(token) {
        let body = '';
        for (const item of token.items) {
          body += this.listitem(item);
        }
        if (token.ordered) {
          const start = token.start;
          const startAttr = start && start !== 1 ? ` start="${start}"` : '';
          return `<ol${startAttr}>\n${body}</ol>\n`;
        }
        const isDash = Boolean(token.raw && token.raw.trimStart().startsWith('-'));
        const bulletAttr = isDash ? ' data-bullet="-" class="list-dash"' : ' data-bullet="*" class="list-star"';
        return `<ul${bulletAttr}>\n${body}</ul>\n`;
      },
      image(token) {
        const src = token.href;
        const alt = token.text || '';
        const title = token.title || '';
        const titleAttr = title ? ` title="${title}"` : '';
        return `<img src="${src}" alt="${alt}"${titleAttr} />`;
      },
      paragraph(token) {
        // When a paragraph consists solely of a single image token, render it as a standalone <figure> without wrapping in <p>
        if (token.tokens && token.tokens.length === 1 && token.tokens[0].type === 'image') {
          const imgToken = token.tokens[0] as { href: string; text?: string; title?: string };
          const src = imgToken.href;
          const alt = imgToken.text || '';
          const title = imgToken.title || '';
          const titleAttr = title ? ` title="${title}"` : '';
          const captionHtml = title
            ? `<figcaption class="image-caption">${title}</figcaption>`
            : '';
          return `<figure class="image-figure"><img src="${src}" alt="${alt}"${titleAttr} />${captionHtml}</figure>\n`;
        }
        return false;
      },
    },
  });
}

/**
 * Compiles Markdown to HTML consistently with the Markdown Editor WYSIWYG:
 * - Configures GFM, breaks: true, and '-' vs '*' list bullet tags
 * - Preserves sequences of 3+ newlines as explicit empty paragraphs (<p class="empty-line"><br /></p>)
 *   so visual blank lines in the WYSIWYG editor are preserved in the HTML render
 */
export function compileMarkdownToHtml(markdown: string): string {
  configureMarked();
  if (!markdown) return '';
  const normalized = markdown.replace(/\n{3,}/g, (match) => {
    const extraCount = match.length - 2;
    return '\n\n' + '<p class="empty-line"><br /></p>\n\n'.repeat(extraCount);
  });
  return marked.parse(normalized, { async: false }) as string;
}
