import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { FindAnInstructorComponent } from './app/find-an-instructor/find-an-instructor';

import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
// import { provideHttpClient } from '@angular/common/http'; // Import provideHttpClient

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    // provideHttpClient(),
  ],
};

(async () => {
  const app = await createApplication(appConfig);
  const element = createCustomElement(FindAnInstructorComponent, {
    injector: app.injector,
  });
  customElements.define('app-find-an-instructor', element);
})();
