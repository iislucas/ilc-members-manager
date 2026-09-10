import { Component, input, effect, signal, ChangeDetectionStrategy } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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

  constructor(private sanitizer: DomSanitizer) {
    effect(() => {
      const val = this.markdown();
      const html = compileMarkdownToHtml(val);
      this.safeHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
    });
  }
}
