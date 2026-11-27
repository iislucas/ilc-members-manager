/*
AnalyticsErrorHandler: Global Angular ErrorHandler that reports uncaught
client-side errors to Firebase Analytics (GA4) via `AnalyticsService`.

Registered in `app.config.ts` alongside `provideBrowserGlobalErrorListeners()`,
so it receives uncaught Angular template/effect/handler errors as well as global
browser `error` and `unhandledrejection` events. Always forwards to
`console.error` so browser diagnostics remain intact.
*/
import { ErrorHandler, inject, Injectable } from '@angular/core';
import { AnalyticsService } from './analytics.service';
import { AppPathPatterns } from './app.config';
import { RoutingService } from './routing.service';

@Injectable()
export class AnalyticsErrorHandler implements ErrorHandler {
  private analytics = inject(AnalyticsService);
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);

  handleError(error: unknown): void {
    console.error(error);
    const { routePattern, viewId } = this.routingService.currentRouteContext();
    this.analytics.logClientError(error, {
      routePattern,
      viewId,
      fatal: false,
    });
  }
}
