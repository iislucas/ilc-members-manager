import { describe, it, expect } from 'vitest';
import { markdownToHtml, findUnsupportedEmailMarkdown, formatTemplate } from './email-markdown';

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

describe('formatTemplate', () => {
  it('substitutes multiple keys accurately', () => {
    const template = 'Hello {name}, your ID is {memberId} and email is {email}.';
    const result = formatTemplate(template, {
      name: 'Alex Chen',
      memberId: 'US402',
      email: 'alex@example.com',
    });
    expect(result).toBe('Hello Alex Chen, your ID is US402 and email is alex@example.com.');
  });

  it('tolerates whitespace inside token braces', () => {
    const template = 'Hello { name }, your code is {  code }.';
    const result = formatTemplate(template, {
      name: 'Alex',
      code: '12345',
    });
    expect(result).toBe('Hello Alex, your code is 12345.');
  });

  it('safely handles replacement strings containing dollar signs ($) and regex pattern chars', () => {
    const template = 'Total price: {amount} for {item}. Check {link}.';
    const result = formatTemplate(template, {
      amount: '$120.00',
      item: 'Annual & Membership',
      link: 'https://example.com/pay?a=1&$b=2',
    });
    expect(result).toBe('Total price: $120.00 for Annual & Membership. Check https://example.com/pay?a=1&$b=2.');
  });

  it('safely handles $& and $ patterns without regex backreference corruption', () => {
    const template = 'Value: {val}';
    const result = formatTemplate(template, {
      val: 'foo$&bar$\'baz',
    });
    expect(result).toBe('Value: foo$&bar$\'baz');
  });

  it('leaves unmentioned tokens untouched', () => {
    const template = 'Hello {name}, order {orderNumber}';
    const result = formatTemplate(template, { name: 'Lucas' });
    expect(result).toBe('Hello Lucas, order {orderNumber}');
  });

  it('returns empty string on falsy template and handles missing replacements', () => {
    expect(formatTemplate('')).toBe('');
    expect(formatTemplate(null as unknown as string)).toBe('');
    expect(formatTemplate(undefined as unknown as string)).toBe('');
    expect(formatTemplate('No tokens')).toBe('No tokens');
  });
});

