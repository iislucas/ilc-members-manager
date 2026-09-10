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
    },
  });
}
