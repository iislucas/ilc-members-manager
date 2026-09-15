import { Component, input, effect, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { compileMarkdownToHtml } from './markdown-config';

@Component({
  selector: 'app-markdown-viewer',
  imports: [],
  template: `<div class="markdown-viewer" [innerHTML]="safeHtml()"></div>`,
  styleUrl: './markdown-viewer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownViewer {
  markdown = input<string>('');
  safeHtml = signal<SafeHtml>('');
  private sanitizer = inject(DomSanitizer);

  constructor() {
    effect(() => {
      const val = this.markdown();
      const rawHtml = compileMarkdownToHtml(val);
      const cleanHtml = DOMPurify.sanitize(rawHtml, {
        ADD_TAGS: ['figure', 'figcaption'],
        ADD_ATTR: ['data-bullet', 'target', 'class'],
      });
      this.safeHtml.set(this.sanitizer.bypassSecurityTrustHtml(cleanHtml));
    });
  }
}
