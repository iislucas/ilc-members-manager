import { describe, it, expect } from 'vitest';
import { htmlToMarkdown } from './html-to-markdown';

describe('htmlToMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   ')).toBe('');
  });

  it('converts paragraphs and line breaks', () => {
    const html = '<p>First paragraph.</p><p>Second paragraph with<br>line break.</p>';
    expect(htmlToMarkdown(html)).toBe('First paragraph.\n\nSecond paragraph with\nline break.');
  });

  it('converts headings h1 through h6', () => {
    const html = '<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3>';
    expect(htmlToMarkdown(html)).toBe('# Heading 1\n\n## Heading 2\n\n### Heading 3');
  });

  it('converts formatting: bold, italic, inline code', () => {
    const html = '<p>Text with <strong>bold</strong>, <em>italic</em>, and <code>const x = 1;</code>.</p>';
    expect(htmlToMarkdown(html)).toBe('Text with **bold**, *italic*, and `const x = 1;`.');
  });

  it('converts links and images', () => {
    const html = '<p><a href="https://iliqchuan.com">ILC Website</a> and <img src="/logo.png" alt="ILC Logo"></p>';
    expect(htmlToMarkdown(html)).toBe('[ILC Website](https://iliqchuan.com) and ![ILC Logo](/logo.png)');
  });

  it('converts unordered and ordered lists', () => {
    const ulHtml = '<ul><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>';
    expect(htmlToMarkdown(ulHtml)).toBe('- Alpha\n- Beta\n- Gamma');

    const olHtml = '<ol><li>Step 1</li><li>Step 2</li></ol>';
    expect(htmlToMarkdown(olHtml)).toBe('1. Step 1\n2. Step 2');
  });

  it('converts blockquotes', () => {
    const html = '<blockquote>Wise words from Sifu</blockquote>';
    expect(htmlToMarkdown(html)).toBe('> Wise words from Sifu');
  });

  it('converts preformatted code blocks', () => {
    const html = '<pre><code>function test() {\n  return true;\n}</code></pre>';
    expect(htmlToMarkdown(html)).toBe('```\nfunction test() {\n  return true;\n}\n```');
  });

  it('strips script and style tags', () => {
    const html = '<p>Hello</p><script>alert("bad")</script><style>.bad{color:red}</style>';
    expect(htmlToMarkdown(html)).toBe('Hello');
  });

  it('converts figures with figcaption or title to markdown image with caption', () => {
    const figureWithCaption = '<figure class="image-figure"><img src="https://example.com/pic.jpg" alt="Master Sam Chin"><figcaption class="image-caption">Demonstrating the neutral point</figcaption></figure>';
    expect(htmlToMarkdown(figureWithCaption)).toBe('![Master Sam Chin](https://example.com/pic.jpg "Demonstrating the neutral point")');

    const figureWithoutCaption = '<figure class="image-figure"><img src="https://example.com/pic.jpg" alt="Just a photo"></figure>';
    expect(htmlToMarkdown(figureWithoutCaption)).toBe('![Just a photo](https://example.com/pic.jpg)');

    const imgWithTitle = '<p><img src="https://example.com/pic.jpg" alt="Inline photo" title="Hover caption"></p>';
    expect(htmlToMarkdown(imgWithTitle)).toBe('![Inline photo](https://example.com/pic.jpg "Hover caption")');
  });
});
