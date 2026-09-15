/* main.ts
 *
 * Entry point for the Angular Documentation Application.
 */

import { bootstrapApplication } from '@angular/platform-browser';
import { provideZonelessChangeDetection } from '@angular/core';
import { AppDocsRootComponent } from './app/app.component';

bootstrapApplication(AppDocsRootComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((err) => console.error(err));
