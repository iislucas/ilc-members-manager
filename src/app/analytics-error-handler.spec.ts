/*
Unit tests for AnalyticsErrorHandler verifying console forwarding and route-scoped
client error reporting to AnalyticsService.
*/
import { ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AnalyticsErrorHandler } from './analytics-error-handler';
import { AnalyticsService } from './analytics.service';
import { AppPathPatterns, initPathPatterns, ROUTING_CONFIG } from './app.config';
import { RoutingService } from './routing.service';

describe('AnalyticsErrorHandler', () => {
  let handler: ErrorHandler;
  let routing: RoutingService<AppPathPatterns>;
  let logClientErrorSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.replaceState(null, '', '/events/ev-42');
    window.scrollTo = vi.fn();
    logClientErrorSpy = vi.fn().mockReturnValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RoutingService,
        {
          provide: ROUTING_CONFIG,
          useValue: { validPathPatterns: initPathPatterns },
        },
        {
          provide: AnalyticsService,
          useValue: {
            logPageView: vi.fn(),
            logClientError: logClientErrorSpy,
          } as never as AnalyticsService,
        },
        { provide: ErrorHandler, useClass: AnalyticsErrorHandler },
      ],
    });

    routing = TestBed.inject(RoutingService);
    handler = TestBed.inject(ErrorHandler);
  });

  it('forwards uncaught errors to console.error and logs them with the active route context', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new TypeError('Boom');

    handler.handleError(err);

    expect(consoleSpy).toHaveBeenCalledWith(err);
    expect(logClientErrorSpy).toHaveBeenCalledWith(err, {
      routePattern: '/events/:eventId',
      viewId: 'eventView',
      fatal: false,
    });
    consoleSpy.mockRestore();
  });

  it('reports /not-found context when an error occurs on an unmatched URL', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    routing.navigateTo('/unknown/path');

    const err = new Error('Broken state');
    handler.handleError(err);

    expect(logClientErrorSpy).toHaveBeenCalledWith(err, {
      routePattern: '/not-found',
      viewId: 'not_found',
      fatal: false,
    });
    consoleSpy.mockRestore();
  });
});
