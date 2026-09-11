/* markdown-viewer.spec.ts
 *
 * Tests for MarkdownViewer component, verifying proper HTML compilation
 * and bullet styling attributes for dash vs star lists.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownViewer } from './markdown-viewer';

describe('MarkdownViewer', () => {
  let component: MarkdownViewer;
  let fixture: ComponentFixture<MarkdownViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownViewer],
    }).compileComponents();

    fixture = TestBed.createComponent(MarkdownViewer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders markdown with distinct bullet attributes for - and * lists', async () => {
    fixture.componentRef.setInput(
      'markdown',
      '- Dash 1\n- Dash 2\n\n* Star 1\n* Star 2'
    );
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fixture.detectChanges();

    const lists = fixture.nativeElement.querySelectorAll('ul');
    expect(lists.length).toBe(2);

    // First list: dash
    expect(lists[0].getAttribute('data-bullet')).toBe('-');
    expect(lists[0].classList.contains('list-dash')).toBe(true);
    expect(lists[0].textContent).toContain('Dash 1');

    // Second list: star
    expect(lists[1].getAttribute('data-bullet')).toBe('*');
    expect(lists[1].classList.contains('list-star')).toBe(true);
    expect(lists[1].textContent).toContain('Star 1');
  });

  it('renders ordered lists correctly without bullet attributes', async () => {
    fixture.componentRef.setInput('markdown', '1. First\n2. Second');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fixture.detectChanges();

    const ol = fixture.nativeElement.querySelector('ol');
    expect(ol).toBeTruthy();
    expect(ol.textContent).toContain('First');
    expect(ol.textContent).toContain('Second');
  });

  it('preserves extra empty lines (3+ newlines) as empty-line paragraphs', async () => {
    fixture.componentRef.setInput('markdown', 'Paragraph 1\n\n\nParagraph 2');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fixture.detectChanges();

    const emptyLineP = fixture.nativeElement.querySelector('p.empty-line');
    expect(emptyLineP).toBeTruthy();
    expect(emptyLineP.querySelector('br')).toBeTruthy();
  });

  it('renders blockquotes, inline code, and code blocks correctly', async () => {
    fixture.componentRef.setInput(
      'markdown',
      '> This is a quote\n\nHere is `inline code` and:\n\n```\nblock code\n```'
    );
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fixture.detectChanges();

    const bq = fixture.nativeElement.querySelector('blockquote');
    expect(bq).toBeTruthy();
    expect(bq.textContent).toContain('This is a quote');

    const inlineCode = fixture.nativeElement.querySelector('p code');
    expect(inlineCode).toBeTruthy();
    expect(inlineCode.textContent).toBe('inline code');

    const pre = fixture.nativeElement.querySelector('pre');
    expect(pre).toBeTruthy();
    expect(pre.textContent).toContain('block code');
  });

  it('renders images with captions as <figure> with <figcaption>', async () => {
    fixture.componentRef.setInput(
      'markdown',
      '![Demonstration](https://example.com/demo.jpg "Master Sam Chin demonstrating neutral")'
    );
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fixture.detectChanges();

    const figure = fixture.nativeElement.querySelector('figure.image-figure');
    expect(figure).toBeTruthy();

    const img = figure.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/demo.jpg');
    expect(img.getAttribute('alt')).toBe('Demonstration');
    expect(img.getAttribute('title')).toBe('Master Sam Chin demonstrating neutral');

    const figcaption = figure.querySelector('figcaption.image-caption');
    expect(figcaption).toBeTruthy();
    expect(figcaption.textContent).toBe('Master Sam Chin demonstrating neutral');
  });

  it('renders standalone images without captions as <figure> without <figcaption>', async () => {
    fixture.componentRef.setInput(
      'markdown',
      '![Photo](https://example.com/photo.jpg)'
    );
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 100));
    fixture.detectChanges();

    const figure = fixture.nativeElement.querySelector('figure.image-figure');
    expect(figure).toBeTruthy();
    expect(figure.querySelector('img')).toBeTruthy();
    expect(figure.querySelector('figcaption')).toBeNull();
  });
});
