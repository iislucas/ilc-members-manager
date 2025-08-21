import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';

import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http'; // Import provideHttpClient

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
  ],
};

(async () => {
  const app = await createApplication(appConfig);
  const eventListElement = createCustomElement(EventListComponent, {
    injector: app.injector,
  });
  customElements.define('event-list-component', eventListElement);
})();
