import { Provider, signal } from '@angular/core';
import { NavigationTreeService } from './navigation-tree';

/**
 * Stubs the navigation tree for component tests.
 *
 * Any page that renders `<app-back-link>` pulls in NavigationTreeService, which
 * in turn needs the routing config, Firebase and the data services. Component
 * specs that only care about the page itself can stub it out with this: the
 * back link then reports no parent and renders nothing.
 *
 * The tree's own behaviour — which page sits above which — is covered directly
 * in navigation-tree.spec.ts.
 */
export function provideNavigationTreeStub(): Provider {
  return {
    provide: NavigationTreeService,
    useValue: {
      parent: signal(null),
      ancestors: signal([]),
      breadcrumbs: signal([]),
      currentView: signal(null),
      currentTitle: signal(''),
      currentTitleIsLoading: signal(false),
      loadedEventTitle: signal(null),
      loadedOrderTitle: signal(null),
      loadedSchoolTitle: signal(null),
      loadedGradingTitle: signal(null),
      loadedInstructorTitle: signal(null),
    },
  };
}
