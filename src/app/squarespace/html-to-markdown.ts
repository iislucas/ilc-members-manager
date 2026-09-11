/**
 * Converts basic/rich HTML content into clean Markdown.
 * Used as a fallback when editing legacy articles that only have an HTML `body`.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || '';
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const el = node as HTMLElement;
    const tagName = el.tagName.toUpperCase();

    switch (tagName) {
      case 'H1':
        return `\n\n# ${getChildren(el).trim()}\n\n`;
      case 'H2':
        return `\n\n## ${getChildren(el).trim()}\n\n`;
      case 'H3':
        return `\n\n### ${getChildren(el).trim()}\n\n`;
      case 'H4':
        return `\n\n#### ${getChildren(el).trim()}\n\n`;
      case 'H5':
        return `\n\n##### ${getChildren(el).trim()}\n\n`;
      case 'H6':
        return `\n\n###### ${getChildren(el).trim()}\n\n`;
      case 'P':
        return `\n\n${getChildren(el).trim()}\n\n`;
      case 'BR':
        return '\n';
      case 'HR':
        return '\n\n---\n\n';
      case 'STRONG':
      case 'B': {
        const text = getChildren(el).trim();
        return text ? `**${text}**` : '';
      }
      case 'EM':
      case 'I': {
        const text = getChildren(el).trim();
        return text ? `*${text}*` : '';
      }
      case 'A': {
        const href = el.getAttribute('href') || '';
        const text = getChildren(el).trim() || href;
        if (!href) return text;
        return `[${text}](${href})`;
      }
      case 'FIGURE': {
        const img = el.querySelector('img');
        if (!img) return getChildren(el);
        const src = img.getAttribute('src') || '';
        const alt = img.getAttribute('alt') || '';
        const captionEl = el.querySelector('figcaption') || el.querySelector('.image-caption');
        const caption = captionEl ? captionEl.textContent?.trim() : (img.getAttribute('title') || '');
        if (!src) return '';
        return caption ? `\n\n![${alt}](${src} "${caption}")\n\n` : `\n\n![${alt}](${src})\n\n`;
      }
      case 'IMG': {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || '';
        const title = el.getAttribute('title') || '';
        if (!src) return '';
        return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
      }
      case 'BLOCKQUOTE': {
        const text = getChildren(el).trim();
        const lines = text.split('\n');
        const quoted = lines.map(line => `> ${line}`).join('\n');
        return `\n\n${quoted}\n\n`;
      }
      case 'UL': {
        let listItems = '';
        Array.from(el.children).forEach((child) => {
          if (child.tagName.toUpperCase() === 'LI') {
            const itemText = getChildren(child as HTMLElement).trim();
            listItems += `- ${itemText}\n`;
          }
        });
        return `\n\n${listItems}\n\n`;
      }
      case 'OL': {
        let listItems = '';
        let idx = 1;
        Array.from(el.children).forEach((child) => {
          if (child.tagName.toUpperCase() === 'LI') {
            const itemText = getChildren(child as HTMLElement).trim();
            listItems += `${idx}. ${itemText}\n`;
            idx++;
          }
        });
        return `\n\n${listItems}\n\n`;
      }
      case 'CODE': {
        if (el.parentElement?.tagName.toUpperCase() === 'PRE') {
          return el.textContent || '';
        }
        return `\`${el.textContent || ''}\``;
      }
      case 'PRE': {
        const codeEl = el.querySelector('code');
        const codeText = codeEl ? codeEl.textContent : el.textContent;
        return `\n\n\`\`\`\n${codeText || ''}\n\`\`\`\n\n`;
      }
      case 'SCRIPT':
      case 'STYLE':
        return '';
      default:
        return getChildren(el);
    }
  }

  function getChildren(element: HTMLElement): string {
    return Array.from(element.childNodes).map(walk).join('');
  }

  const raw = walk(doc.body);
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
