/* events-viewer.wc.ts
 *
 * Entry point for the standalone Events Viewer web component.
 * Bootstraps a minimal Angular application and registers the
 * <app-events-viewer> custom element, which displays a searchable,
 * public list of ILC events sourced from Firestore.
 *
 * Usage:
 *   pnpm start:events-wc
 *
 * Build:
 *   pnpm build:events-wc
 */

import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { EventsViewerComponent } from './app/events-viewer/events-viewer';

import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { initializeApp } from 'firebase/app';
import { environment } from './environments/environment';
import { FIREBASE_APP, ROUTING_CONFIG } from './app/app.config';
import { addUrlParams, pathPattern, pv } from './app/routing.utils';

// Minimal path patterns for the events viewer — just enough for the
// EventListComponent to resolve hrefs. No auth-gated views needed.
const eventsPathPatterns = {
  eventsCalendar: pathPattern`events`,
  eventView: pathPattern`events/${pv('eventId')}`,
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    {
      provide: FIREBASE_APP,
      useValue: initializeApp(environment.firebase),
    },
    {
      provide: ROUTING_CONFIG,
      useValue: { validPathPatterns: eventsPathPatterns },
    },
  ],
};

(async () => {
  const app = await createApplication(appConfig);
  const element = createCustomElement(EventsViewerComponent, {
    injector: app.injector,
  });
  customElements.define('app-events-viewer', element);
})();
