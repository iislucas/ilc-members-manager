import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { FindAnInstructorComponent } from './app/find-an-instructor/find-an-instructor';

import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { initializeApp } from 'firebase/app';
import { environment } from './environments/environment';
import { FIREBASE_APP } from './app/app.config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    {
      provide: FIREBASE_APP,
      useValue: initializeApp(environment.firebase),
    },
  ],
};

(async () => {
  const app = await createApplication(appConfig);
  const element = createCustomElement(FindAnInstructorComponent, {
    injector: app.injector,
  });
  customElements.define('app-find-an-instructor', element);
})();
