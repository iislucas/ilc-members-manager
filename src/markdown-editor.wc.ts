import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { MarkdownEditor } from './app/markdown-editor/markdown-editor';
import { MarkdownViewer } from './app/markdown-editor/markdown-viewer';
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
  ],
};

(async () => {
  const app = await createApplication(appConfig);
  
  const editorElement = createCustomElement(MarkdownEditor, {
    injector: app.injector,
  });
  customElements.define('app-markdown-editor', editorElement);
  
  const viewerElement = createCustomElement(MarkdownViewer, {
    injector: app.injector,
  });
  customElements.define('app-markdown-viewer', viewerElement);
})();
