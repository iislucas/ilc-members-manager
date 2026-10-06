/*
RoutingService: A Strongly-Typed, Signal-Based Router

Key Principles:

1. Configuration-Based: Valid routes (PathPatterns) are defined centrally (e.g., in
   app.config.ts) and injected into this service via the ROUTING_CONFIG token.

2. Strongly Typed: The router leverages TypeScript template literal types and generics to
   ensure complete type safety. Path variables (e.g., `/:memberId`) and URL query parameters
   are rigorously statically typed. This provides compile-time validation and autocompletion
   when accessing or updating routing parameters.

3. Signal-Driven: State management uses Angular Signals (WritableSignal) instead of
   Observables. This provides a modern, synchronous-feeling reactive API that integrates
   seamlessly with Angular's `computed` and `effect` primitives and Zoneless Change Detection.

4. Two-Way Synchronization: The service guarantees a bidirectional binding between the browser's
   URL (using the HTML5 History API — path + query string) and the internal Signal state. Mutating
   a routing Signal automatically updates the browser URL, and navigation events instantly reflect
   back into the Signals.

CRITICAL — Explicit Type Annotation Required:

When injecting RoutingService, you MUST use an explicit type annotation on the property.
Without the annotation, TypeScript's mapped types are not resolved, and dot notation on
`urlParams` and `pathVars` will fail with TS4111 errors. Never use bracket notation
(e.g. `['q']`) as a workaround.

  ❌ BAD:   routingService = inject(RoutingService<AppPathPatterns>);
  ✅ GOOD:  routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);

Then access signals directly via the Views enum with dot notation:

  // Single-view: store direct reference to avoid repeated lookups.
  private viewSignals = this.routingService.signals[Views.FindAnInstructor];
  searchTerm = computed(() => this.viewSignals.urlParams.q());

  // Multi-view: use a computed to dispatch.
  private viewSignals = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MySchools) return this.routingService.signals[Views.MySchools];
    return this.routingService.signals[Views.ManageSchools];
  });
  searchTerm = computed(() => this.viewSignals().urlParams.q());

Example Usage:

// 1. Define routes (typically in app.config.ts)
export const myRoutes = {
  home: pathPattern``,
  // `pv('userId')` declares a strongly-typed path variable that matches `user/:userId`.
  // `['tab']` declares a strongly-typed, optional URL query parameter `?tab=value`.
  profile: addUrlParams(pathPattern`user/${pv('userId')}`, ['tab']),
};
export type MyRoutes = typeof myRoutes;

// 2. Inject and use in a component
export class ProfileComponent {
  // MUST have an explicit type annotation for dot notation to work!
  router: RoutingService<MyRoutes> = inject(RoutingService<MyRoutes>);

  constructor() {
    // Read parameters reactively with complete type safety
    effect(() => {
      if (this.router.matchedPatternId() === 'profile') {
        // Autocomplete knows exactly what pathVars and urlParams exist!
        const userId = this.router.signals.profile.pathVars.userId();
        const tab = this.router.signals.profile.urlParams.tab();
        console.log(`Viewing user ${userId}, tab: ${tab}`);
      }
    });
  }

  navigate(id: string) {
    this.router.navigateToParts(['user', id]); // Pushes a history entry, reflecting back into signals
  }
}
*/
import {
  Injectable,
  signal,
  WritableSignal,
  Inject,
  computed,
  effect,
} from '@angular/core';
import {
  matchUrl,
  updateSignalsFromSubsts,
  PathPatterns,
  PatternSignals,
  UrlParamNames,
  PathVarNames,
} from './routing.utils';
import { ROUTING_CONFIG } from './app.config';

// We use this type in the router, and this type check will ensure we didn't
// mess up the type: if it says never, then initPathPatterns is badly typed, and
// you should try adding the type constraint PathPatterns to the
// initPathPatterns above, to debug.
export type RoutingConfig<P extends PathPatterns> = {
  validPathPatterns: P;
};

export interface ScrollState {
  x: number;
  y: number;
  viewportWidth: number;
  targetUrl?: string;
}

// This Service manages two way binding between the URL and a set of siganls
// derived from a PathPatterns routing configuration. You can call navigate, or
// you can update the current signals; either way around the URL and the signals
// will be sychronized.
@Injectable({
  providedIn: 'root',
})
export class RoutingService<T extends PathPatterns> {
  private currentPath: WritableSignal<string>;
  private currentQuery: WritableSignal<string>;
  public matchedPatternId: WritableSignal<keyof T | null> = signal(null);
  public currentUrl: WritableSignal<string> = signal(
    typeof window !== 'undefined' ? window.location.href : '',
  );
  public signals: {
    [pathId in keyof T]: PatternSignals<
      PathVarNames<T[pathId]>,
      UrlParamNames<T[pathId]>
    >;
  };
  substs = computed(() => {
    const patternId = this.matchedPatternId();
    if (!patternId) {
      return { pathVars: {}, urlParams: {} };
    }
    return this.signals[patternId];
  });

  // In-memory cache for preserving scroll positions across navigations.
  private urlScrollCache = new Map<string, ScrollState>();

  // Flags to indicate return / popstate navigation.
  private isBackNavigation = false;
  private isPopStateNavigation = false;
  private cancelPendingRestore: (() => void) | null = null;

  constructor(@Inject(ROUTING_CONFIG) private config: RoutingConfig<T>) {
    this.currentPath = signal('');
    this.currentQuery = signal('');

    this.signals = {} as {
      [pathId in keyof T]: PatternSignals<
        PathVarNames<T[pathId]>,
        UrlParamNames<T[pathId]>
      >;
    };

    for (const patternId of Object.keys(this.config.validPathPatterns)) {
      const s = new PatternSignals<
        PathVarNames<T[typeof patternId]>,
        UrlParamNames<T[typeof patternId]>
      >(this.config.validPathPatterns[patternId] as T[keyof T]);
      this.signals[patternId as keyof T] = s;
    }

    if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
      try {
        window.history.scrollRestoration = 'manual';
      } catch {
        // Ignore error if browser environment restricts modifying scrollRestoration
      }
    }

    // Respond to back/forward navigation.
    window.addEventListener('popstate', () => {
      this.isPopStateNavigation = true;
      try {
        this.handleUrlChange();
      } finally {
        this.isPopStateNavigation = false;
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.saveCurrentScrollPosition();
      });
    }

    // Seed the signals from the initial URL.
    this.handleUrlChange();

    // Sync signal state back into the URL. This fires when a component mutates a
    // URL-param signal (e.g. a search box); we use replaceState so those in-page
    // updates don't spam the history stack. Genuine page navigations go through
    // navigateTo() which pushes a new history entry.
    effect(() => {
      // Only take over the URL when the current location actually matches one of
      // our routes. This keeps the router inert when embedded as a web component
      // on a host page whose path we don't own (so we never rewrite it).
      if (this.matchedPatternId() === null) {
        return;
      }
      const path = this.constructPath();
      const query = this.constructQuery();
      const pathWithSlash = path.startsWith('/') ? path : `/${path}`;
      const newUrl = `${pathWithSlash}${query}`;
      if (this.currentUrlPart() !== newUrl) {
        window.history.replaceState(null, '', newUrl);
        if (typeof window !== 'undefined') {
          this.currentUrl.set(window.location.href);
        }
      }
    });
  }

  /** The current path + query as an absolute URL string, e.g. `/members?q=x`. */
  private currentUrlPart(): string {
    return `${window.location.pathname}${window.location.search}`;
  }

  private constructPath(): string {
    const patternId = this.matchedPatternId();
    if (!patternId) {
      return this.currentPath();
    }
    const parts = this.config.validPathPatterns[patternId].pathParts;
    const substParts = parts.map((part) => {
      if (part.startsWith(':')) {
        const paramName = part.substring(1);
        const val = this.signals[patternId].pathVars[
          paramName as keyof T[keyof T]['pathVars'] & string
        ]();
        return encodeURIComponent(val ?? '');
      } else {
        return part;
      }
    });
    return substParts.join('/');
  }

  private constructQuery(): string {
    const patternId = this.matchedPatternId();
    if (!patternId) {
      return this.currentQuery();
    }
    const patternSignals = this.signals[patternId];
    const defaults = patternSignals.urlParamDefaults;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries<WritableSignal<string>>(
      patternSignals.urlParams,
    )) {
      const v = value();
      // Only write to the URL if the value differs from the default.
      if (v !== (defaults[key] ?? '')) {
        params.set(key, v);
      }
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }

  private normalizeUrlKey(url: string): string {
    let normalized = url.trim();
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    return normalized.replace(/\/+/g, '/');
  }

  saveCurrentScrollPosition(targetUrl?: string) {
    if (typeof window === 'undefined') return;
    const currentUrl = this.normalizeUrlKey(this.currentUrlPart());
    const state: ScrollState = {
      x: window.scrollX,
      y: window.scrollY,
      viewportWidth: window.innerWidth,
      targetUrl: targetUrl ? this.normalizeUrlKey(targetUrl) : undefined,
    };
    this.urlScrollCache.set(currentUrl, state);

    if (this.urlScrollCache.size > 50) {
      const oldestKey = this.urlScrollCache.keys().next().value;
      if (oldestKey) {
        this.urlScrollCache.delete(oldestKey);
      }
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(`scroll_${currentUrl}`, JSON.stringify(state));
      }
    } catch {
      // Ignore storage errors
    }

    try {
      if (typeof window.history !== 'undefined' && window.history.replaceState) {
        window.history.replaceState({ ...window.history.state, scrollPos: state }, '');
      }
    } catch {
      // Ignore history state errors
    }
  }

  getSavedScrollPosition(url: string): ScrollState | undefined {
    const key = this.normalizeUrlKey(url);
    if (this.urlScrollCache.has(key)) {
      return this.urlScrollCache.get(key);
    }
    const pathOnly = this.normalizeUrlKey(url.split('?')[0]);
    if (this.urlScrollCache.has(pathOnly)) {
      return this.urlScrollCache.get(pathOnly);
    }

    // Try matching if the requested URL is a base route or sub-route of a saved URL
    // e.g. /members-area vs /members-area/category/All
    for (const [cachedUrl, state] of this.urlScrollCache.entries()) {
      const cachedPathOnly = cachedUrl.split('?')[0];
      if (
        (pathOnly.startsWith(cachedPathOnly) || cachedPathOnly.startsWith(pathOnly)) &&
        (pathOnly.startsWith('/members-area') ||
          pathOnly.startsWith('/instructors-area') ||
          pathOnly.startsWith('/articles'))
      ) {
        return state;
      }
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        const item = sessionStorage.getItem(`scroll_${key}`) || sessionStorage.getItem(`scroll_${pathOnly}`);
        if (item) {
          return JSON.parse(item) as ScrollState;
        }
      }
    } catch {
      // Ignore storage errors
    }
    return undefined;
  }

  private restoreScrollPosition(saved: ScrollState, maxWaitMs = 1500): void {
    if (typeof window === 'undefined') return;

    if (this.cancelPendingRestore) {
      this.cancelPendingRestore();
      this.cancelPendingRestore = null;
    }

    const targetY = saved.y;
    const targetAnchorUrl = saved.targetUrl;
    const savedWidth = saved.viewportWidth;
    const isSameWidth = Math.abs(window.innerWidth - savedWidth) < 30;

    if (targetY <= 0 && !targetAnchorUrl) {
      if (typeof window.scrollTo === 'function') {
        window.scrollTo(0, 0);
      }
      return;
    }

    let cancelled = false;

    const onUserInteraction = () => {
      cancelled = true;
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener('wheel', onUserInteraction);
      window.removeEventListener('touchmove', onUserInteraction);
      window.removeEventListener('keydown', onUserInteraction);
      this.cancelPendingRestore = null;
    };

    this.cancelPendingRestore = () => {
      cancelled = true;
      cleanup();
    };

    window.addEventListener('wheel', onUserInteraction, { passive: true, once: true });
    window.addEventListener('touchmove', onUserInteraction, { passive: true, once: true });
    window.addEventListener('keydown', onUserInteraction, { passive: true, once: true });

    const startTime = performance.now();

    const triggerElementHighlight = (element: HTMLElement) => {
      element.classList.remove('nav-returned-highlight');
      // Force reflow so re-adding the class triggers the animation if previously applied
      void element.offsetWidth;
      element.classList.add('nav-returned-highlight');
      const onEnd = () => {
        element.classList.remove('nav-returned-highlight');
        element.removeEventListener('animationend', onEnd);
      };
      element.addEventListener('animationend', onEnd, { once: true });
      // Fallback timeout in case animationend does not fire (e.g. reduced motion or detached)
      setTimeout(() => element.classList.remove('nav-returned-highlight'), 2200);
    };

    const findTargetCard = (anchorUrl: string): HTMLElement | null => {
      let cleanTarget = anchorUrl;
      if (cleanTarget.startsWith('/')) cleanTarget = cleanTarget.substring(1);
      const anchorEl = document.querySelector<HTMLElement>(
        `a[href="${anchorUrl}"], a[href="/${cleanTarget}"], a[href="${cleanTarget}"]`
      );
      if (!anchorEl) return null;
      return (
        anchorEl.closest<HTMLElement>(
          '.selectable-card, .instructor-card, .school-card, .event-card-link, tr, article, .member-card, .grading-card'
        ) || anchorEl
      );
    };

    const attempt = () => {
      if (cancelled) return;

      // Priority 1: When orientation changed or when an anchor URL was recorded,
      // locate the card or anchor element corresponding to the detail page.
      if (targetAnchorUrl) {
        const cardEl = findTargetCard(targetAnchorUrl);
        if (cardEl && (cardEl.offsetHeight > 0 || cardEl.scrollHeight > 0)) {
          if (!isSameWidth) {
            if (typeof cardEl.scrollIntoView === 'function') {
              cardEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
            triggerElementHighlight(cardEl);
            cleanup();
            return;
          }
        }
      }

      // Priority 2: If same width and document height can reach targetY, scroll directly
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = document.documentElement.clientHeight;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      if (maxScroll >= targetY) {
        if (typeof window.scrollTo === 'function') {
          window.scrollTo({ top: targetY, left: saved.x, behavior: 'instant' });
        }
        if (targetAnchorUrl) {
          const cardEl = findTargetCard(targetAnchorUrl);
          if (cardEl) {
            triggerElementHighlight(cardEl);
          }
        }
        cleanup();
        return;
      }

      // Priority 3: Retry if document is still rendering and expanding
      if (performance.now() - startTime < maxWaitMs) {
        requestAnimationFrame(attempt);
      } else {
        if (targetAnchorUrl) {
          const cardEl = findTargetCard(targetAnchorUrl);
          if (cardEl) {
            if (typeof cardEl.scrollIntoView === 'function') {
              cardEl.scrollIntoView({ behavior: 'instant', block: 'center' });
            }
            triggerElementHighlight(cardEl);
            cleanup();
            return;
          }
        }

        if (maxScroll > 0 && isSameWidth) {
          if (typeof window.scrollTo === 'function') {
            window.scrollTo({ top: Math.min(targetY, maxScroll), left: saved.x, behavior: 'instant' });
          }
        }
        cleanup();
      }
    };

    requestAnimationFrame(attempt);
  }

  // Tracks the previous matched pattern so we can scroll to the top when the
  // user navigates to a different page, but not when only URL params change
  // within the same page.
  private previousPatternId: keyof T | null = null;

  private handleUrlChange() {
    let path = window.location.pathname;
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    // matchUrl expects the query string appended to the path (it splits on '?').
    const urlPart = `${path}${window.location.search}`;
    const match = matchUrl(urlPart, this.config.validPathPatterns);
    const performUpdate = () => {
      if (match) {
        const patternChanged = this.previousPatternId !== match.patternId;
        if (patternChanged && this.previousPatternId) {
          const prevSignals = this.signals[this.previousPatternId];
          if (prevSignals) {
            for (const key of prevSignals.ephemeralUrlParams ?? []) {
              prevSignals.urlParams[key]?.set(prevSignals.urlParamDefaults[key] ?? '');
            }
            for (const key of Object.keys(prevSignals.pathVars)) {
              prevSignals.pathVars[key]?.set('');
            }
          }
        }
        this.previousPatternId = match.patternId;
        this.matchedPatternId.set(match.patternId);
        updateSignalsFromSubsts(
          match.pathParams,
          this.signals[match.patternId].pathVars,
        );
        updateSignalsFromSubsts(
          match.urlParams,
          this.signals[match.patternId].urlParams,
          this.signals[match.patternId].urlParamDefaults,
        );
        if (patternChanged) {
          const urlPartWithSlash = urlPart.startsWith('/') ? urlPart : `/${urlPart}`;
          const savedScroll = this.getSavedScrollPosition(urlPartWithSlash);
          const isReturning =
            this.isBackNavigation ||
            this.isPopStateNavigation ||
            (savedScroll?.targetUrl &&
              this.normalizeUrlKey(this.currentUrlPart()).startsWith(savedScroll.targetUrl));

          if (isReturning && savedScroll) {
            this.restoreScrollPosition(savedScroll);
          } else {
            if (this.cancelPendingRestore) {
              this.cancelPendingRestore();
              this.cancelPendingRestore = null;
            }
            if (typeof window.scrollTo === 'function') {
              window.scrollTo(0, 0);
            }
          }
        }
      } else {
        this.previousPatternId = null;
        this.matchedPatternId.set(null);
      }
      if (typeof window !== 'undefined') {
        this.currentUrl.set(window.location.href);
      }
    };

    performUpdate();
  }

  navigateTo(
    pathAndParams: string,
    options?: { clearUrlParams?: boolean; isBackNavigation?: boolean },
  ) {
    if (!options?.isBackNavigation) {
      this.saveCurrentScrollPosition(pathAndParams);
    }
    this.isBackNavigation = options?.isBackNavigation ?? false;
    const clearUrlParams = options?.clearUrlParams ?? false;
    const resolved = clearUrlParams ? pathAndParams : this.resolveUrlWithParams(pathAndParams);
    const url = resolved.startsWith('/') ? resolved : `/${resolved}`;
    // pushState creates a new history entry but does not emit a popstate event,
    // so we manually re-derive the signal state from the new URL.
    try {
      window.history.pushState(null, '', url);
      this.handleUrlChange();
    } finally {
      this.isBackNavigation = false;
    }
  }

  /**
   * AVOID: Prefer using standard <a> tags with hrefs generated by
   * resolveUrlWithParams(path). Only use navigateToParts if you must trigger
   * navigation programmatically from code. Using standard <a> links is better
   * for accessibility and allows users to open links in new tabs.
   */
  navigateToParts(
    parts: string[],
    options?: { clearUrlParams?: boolean; isBackNavigation?: boolean },
  ) {
    this.navigateTo(parts.join('/'), options);
  }

  /**
   * Given a URL path (e.g. '/members' or '/members?jumpTo=123'), match it to a
   * route pattern and append the current signal values for that pattern's URL
   * params. Params already present in the URL are not overwritten.
   *
   * This preserves search, sort, tag filters etc. when navigating back to a
   * list page from a detail page.
   */
  resolveUrlWithParams(pathAndParams: string): string {
    let path = pathAndParams;
    const existingParams = new URLSearchParams();
    const qIndex = pathAndParams.indexOf('?');
    if (qIndex >= 0) {
      path = pathAndParams.substring(0, qIndex);
      const parsed = new URLSearchParams(pathAndParams.substring(qIndex + 1));
      parsed.forEach((v, k) => existingParams.set(k, v));
    }

    // Strip leading slash for matchUrl, which expects a path without it.
    const cleanPath = path.startsWith('/') ? path.substring(1) : path;
    const match = matchUrl(cleanPath, this.config.validPathPatterns);
    if (!match) return pathAndParams;

    // Carry forward current signal values for the matched pattern's URL params.
    // Ephemeral params (e.g. 'from', 'returnUrl') are skipped so they are not
    // accidentally carried into newly constructed links.
    const patternSignals = this.signals[match.patternId as keyof T];
    const defaults = patternSignals.urlParamDefaults;
    for (const [key, sig] of Object.entries<WritableSignal<string>>(
      patternSignals.urlParams,
    )) {
      if (patternSignals.ephemeralUrlParams?.has(key)) {
        continue;
      }
      if (!existingParams.has(key)) {
        const val = sig();
        if (val !== (defaults[key] ?? '')) {
          existingParams.set(key, val);
        }
      }
    }

    const queryString = existingParams.toString();
    return `${path}${queryString ? '?' + queryString : ''}`;
  }

  /**
   * Generate an absolute-path href string for an <a> link, preserving the
   * current URL param signal values for the target route pattern.
   *
   * Usage in templates: `<a [href]="routingService.hrefWithParams('/members')">`
   */
  hrefWithParams(basePath: string): string {
    const resolved = this.resolveUrlWithParams(basePath);
    return resolved.startsWith('/') ? resolved : `/${resolved}`;
  }
  /**
   * Generate an href string for a specific View pattern, with strongly typed path variables
   * and optional strongly typed URL query parameters.
   * Preserves current URL param signals for any parameters not explicitly specified.
   */
  hrefForView<K extends keyof T>(
    view: K,
    ...args: [PathVarNames<T[K]>] extends [never]
      ? [urlParams?: Partial<{ [key in UrlParamNames<T[K]>]: string }>]
      : [
          pathVars: { [key in PathVarNames<T[K]>]: string },
          urlParams?: Partial<{ [key in UrlParamNames<T[K]>]: string }>,
        ]
  ): string {
    const pattern = this.config.validPathPatterns[view];
    const hasPathVars = pattern.pathParts.some((part) => part.startsWith(':'));
    let pathVars: { [key: string]: string } | undefined;
    let urlParams: { [key: string]: string } | undefined;

    if (hasPathVars) {
      pathVars = args[0] as { [key: string]: string } | undefined;
      urlParams = args[1] as { [key: string]: string } | undefined;
    } else {
      urlParams = args[0] as { [key: string]: string } | undefined;
    }

    const substParts = pattern.pathParts.map((part) => {
      if (part.startsWith(':')) {
        const paramName = part.substring(1);
        const val = pathVars?.[paramName];
        if (val === undefined) {
          throw new Error(
            `Missing path variable ${paramName} for view ${String(view)}`,
          );
        }
        return encodeURIComponent(val);
      } else {
        return part;
      }
    });

    let path = substParts.join('/');
    if (urlParams) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(urlParams)) {
        if (v !== undefined && v !== null && v !== '') {
          searchParams.set(k, v);
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        path = `${path}?${qs}`;
      }
    }

    return this.hrefWithParams(path);
  }
}
