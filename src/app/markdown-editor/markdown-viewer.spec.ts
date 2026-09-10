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
});
