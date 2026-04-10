import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { MobileEditor } from './app/mobile-editor/mobile-editor';
import { MarkdownViewer } from './app/mobile-editor/markdown-viewer';
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
  ],
};

(async () => {
  const app = await createApplication(appConfig);
  
  const editorElement = createCustomElement(MobileEditor, {
    injector: app.injector,
  });
  customElements.define('app-mobile-editor', editorElement);
  
  const viewerElement = createCustomElement(MarkdownViewer, {
    injector: app.injector,
  });
  customElements.define('app-markdown-viewer', viewerElement);
})();
