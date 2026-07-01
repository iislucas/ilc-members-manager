/* social-preview.spec.ts — tests for the social preview helpers. */
import { describe, it, expect } from 'vitest';
import { toPlainSummary, injectMeta, Preview } from './social-preview';

describe('toPlainSummary', () => {
  it('strips markdown and collapses whitespace', () => {
    expect(toPlainSummary('# Heading\n\nSome **bold**   text.')).toBe(
      'Heading Some bold text.',
    );
  });

  it('strips HTML tags and decodes basic entities', () => {
    expect(toPlainSummary('<p>Hello &amp; welcome</p>')).toBe('Hello & welcome');
  });

  it('keeps link text but drops the URL', () => {
    expect(toPlainSummary('See [our site](https://example.com) now')).toBe(
      'See our site now',
    );
  });

  it('truncates to the max length with an ellipsis', () => {
    const long = 'a'.repeat(300);
    const out = toPlainSummary(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns empty string for empty input', () => {
    expect(toPlainSummary('')).toBe('');
  });
});

describe('injectMeta', () => {
  const shell =
    '<!DOCTYPE html><html><head><title>I Liq Chuan Members Portal App</title></head><body><app-root></app-root></body></html>';
  const preview: Preview = {
    title: 'Spring Seminar',
    description: 'A weekend of I Liq Chuan training.',
    image: 'https://cdn.example.com/hero.jpg',
  };

  it('replaces the <title> with the page title and site name', () => {
    const out = injectMeta(shell, preview, 'https://app.example.com/events/E1');
    expect(out).toContain(
      '<title>Spring Seminar | I Liq Chuan Members Portal</title>',
    );
    // The original generic title should be gone.
    expect(out).not.toContain('<title>I Liq Chuan Members Portal App</title>');
  });

  it('injects Open Graph and Twitter tags before </head>', () => {
    const out = injectMeta(shell, preview, 'https://app.example.com/events/E1');
    expect(out).toContain(
      '<meta property="og:title" content="Spring Seminar" />',
    );
    expect(out).toContain(
      '<meta property="og:image" content="https://cdn.example.com/hero.jpg" />',
    );
    expect(out).toContain(
      '<meta property="og:url" content="https://app.example.com/events/E1" />',
    );
    expect(out).toContain(
      '<meta name="twitter:card" content="summary_large_image" />',
    );
    expect(out).toContain(
      '<meta name="twitter:image" content="https://cdn.example.com/hero.jpg" />',
    );
    // Tags must be inside <head>.
    expect(out.indexOf('og:title')).toBeLessThan(out.indexOf('</head>'));
  });

  it('omits image tags when there is no image', () => {
    const out = injectMeta(shell, { ...preview, image: undefined }, 'https://x/e/1');
    expect(out).not.toContain('og:image');
    expect(out).not.toContain('twitter:image');
  });

  it('HTML-escapes tag content to avoid breaking out of attributes', () => {
    const out = injectMeta(
      shell,
      { title: 'A "quoted" & <tag>', description: 'x' },
      'https://x/e/1',
    );
    expect(out).toContain('content="A &quot;quoted&quot; &amp; &lt;tag&gt;"');
  });
});
