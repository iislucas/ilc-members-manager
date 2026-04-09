import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { MobileEditor } from './app/mobile-editor/mobile-editor';
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
  ],
};

(async () => {
  const app = await createApplication(appConfig);
  const element = createCustomElement(MobileEditor, {
    injector: app.injector,
  });
  customElements.define('app-mobile-editor', element);
})();
