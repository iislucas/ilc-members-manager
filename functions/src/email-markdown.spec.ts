import { describe, it, expect } from 'vitest';
import { markdownToHtml, findUnsupportedEmailMarkdown } from './email-markdown';

describe('markdownToHtml', () => {
  it('renders the supported subset: bold, links, and line breaks', () => {
    expect(markdownToHtml('Hello **world**')).toBe('Hello <strong>world</strong>');
    expect(markdownToHtml('[link](https://x.com)')).toBe('<a href="https://x.com">link</a>');
    expect(markdownToHtml('a\nb')).toBe('a<br>b');
  });

  it('leaves unsupported constructs as literal text', () => {
    expect(markdownToHtml('# Heading')).toBe('# Heading');
    expect(markdownToHtml('- item')).toBe('- item');
  });
});

describe('findUnsupportedEmailMarkdown', () => {
  it('returns nothing for supported content', () => {
    expect(findUnsupportedEmailMarkdown('')).toEqual([]);
    expect(findUnsupportedEmailMarkdown('Welcome **John**!')).toEqual([]);
    expect(
      findUnsupportedEmailMarkdown('See the [members area](https://x.com/#/a).'),
    ).toEqual([]);
    expect(findUnsupportedEmailMarkdown('Line one\nLine two')).toEqual([]);
  });

  it('does not flag characters inside supported constructs', () => {
    // The `*` in bold and the `[]()` in links must not trip italic/link checks.
    expect(findUnsupportedEmailMarkdown('**bold** and [a](b)')).toEqual([]);
  });

  it('flags headings, lists, quotes, code, images, and italic', () => {
    expect(findUnsupportedEmailMarkdown('# Title')).toContain('headings');
    expect(findUnsupportedEmailMarkdown('- one\n- two')).toContain('bullet lists');
    expect(findUnsupportedEmailMarkdown('1. one')).toContain('numbered lists');
    expect(findUnsupportedEmailMarkdown('> quote')).toContain('block quotes');
    expect(findUnsupportedEmailMarkdown('use `code` here')).toContain('code');
    expect(findUnsupportedEmailMarkdown('![alt](img.png)')).toContain('images');
    expect(findUnsupportedEmailMarkdown('some _emphasis_ text')).toContain('italic');
    expect(findUnsupportedEmailMarkdown('some *emphasis* text')).toContain('italic');
  });

  it('reports each construct once and can combine them', () => {
    const issues = findUnsupportedEmailMarkdown('# Title\n- a\n- b');
    expect(issues).toContain('headings');
    expect(issues).toContain('bullet lists');
    expect(issues.filter((i) => i === 'bullet lists')).toHaveLength(1);
  });
});
