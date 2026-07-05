import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Legacy-link compatibility: the app used to use hash-based routing
// (e.g. https://app.iliqchuan.com/#/events/E1). Now that we use path-based
// routing, rewrite any incoming `#/...` URL to its path equivalent before the
// app boots, so previously-shared links and bookmarks still resolve.
const hash = window.location.hash;
if (hash.startsWith('#/')) {
  const target = hash.substring(1); // drop the leading '#', keep the leading '/'
  window.history.replaceState(null, '', target);
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
