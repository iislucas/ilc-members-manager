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
   URL (using the hash fragment) and the internal Signal state. Mutating a routing Signal
   automatically updates the browser URL, and navigation events instantly reflect back into the
   Signals.

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
    this.router.navigateToParts(['user', id]); // Updates hash, reflecting back into signals
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

// This Service manages two way binding between the URL and a set of siganls
// derived from a PathPatterns routing configuration. You can call navigate, or
// you can update the current signals; either way around the URL and the signals
// will be sychronized.
@Injectable({
  providedIn: 'root',
})
export class RoutingService<T extends PathPatterns> {
  private urlHashPath: WritableSignal<string>;
  private urlHashParams: WritableSignal<string>;
  public matchedPatternId: WritableSignal<keyof T | null> = signal(null);
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

  constructor(@Inject(ROUTING_CONFIG) private config: RoutingConfig<T>) {
    this.urlHashPath = signal('');
    this.urlHashParams = signal('');

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

    // TODO: consider doing some checking so that varMap matches exactly the
    // possible values in the path.
    //
    // for (const patternId of Object.keys(config.validPathPatterns)) {
    // validatePaths(this.paths, this.pathParamSignals);
    // }

    window.addEventListener('hashchange', () => this.handleUrlChange());
    this.handleUrlChange();

    effect(() => {
      const path = this.constructPath();
      const query = this.constructQuery();
      const pathWithSlash = path.startsWith('/') ? path : `/${path}`;
      const newHash = `${pathWithSlash}${query}`;
      if (window.location.hash.substring(1) !== newHash) {
        window.location.hash = newHash;
      }
    });
  }

  private constructPath(): string {
    const patternId = this.matchedPatternId();
    if (!patternId) {
      return this.urlHashPath();
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
      return this.urlHashParams();
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries<WritableSignal<string>>(
      this.signals[patternId].urlParams,
    )) {
      const v = value();
      if (v !== '') {
        params.set(key, v);
      }
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }

  // Tracks the previous matched pattern so we can scroll to the top when the
  // user navigates to a different page, but not when only URL params change
  // within the same page.
  private previousPatternId: keyof T | null = null;

  private handleUrlChange() {
    let hashlessUrlPart = window.location.hash.substring(1);
    if (hashlessUrlPart.startsWith('/')) {
      hashlessUrlPart = hashlessUrlPart.substring(1);
    }
    const match = matchUrl(hashlessUrlPart, this.config.validPathPatterns);
    if (match) {
      const patternChanged = this.previousPatternId !== match.patternId;
      this.previousPatternId = match.patternId;
      this.matchedPatternId.set(match.patternId);
      updateSignalsFromSubsts(
        match.pathParams,
        this.signals[match.patternId].pathVars,
      );
      updateSignalsFromSubsts(
        match.urlParams,
        this.signals[match.patternId].urlParams,
      );
      if (patternChanged) {
        window.scrollTo(0, 0);
      }
    } else {
      this.previousPatternId = null;
      this.matchedPatternId.set(null);
    }
  }

  navigateTo(pathAndParams: string, options?: { clearUrlParams?: boolean }) {
    const clearUrlParams = options?.clearUrlParams ?? false;
    const resolved = clearUrlParams ? pathAndParams : this.resolveUrlWithParams(pathAndParams);
    if (resolved.startsWith('/')) {
      window.location.hash = `#${resolved}`;
    } else {
      window.location.hash = `#/${resolved}`;
    }
  }

  /**
   * AVOID: Prefer using standard <a> tags with hrefs generated by
   * resolveUrlWithParams(path). Only use navigateToParts if you must trigger
   * navigation programmatically from code. Using standard <a> links is better
   * for accessibility and allows users to open links in new tabs.
   */
  navigateToParts(parts: string[], options?: { clearUrlParams?: boolean }) {
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
    const patternSignals = this.signals[match.patternId as keyof T];
    for (const [key, sig] of Object.entries<WritableSignal<string>>(
      patternSignals.urlParams,
    )) {
      if (!existingParams.has(key)) {
        const val = sig();
        if (val !== '') {
          existingParams.set(key, val);
        }
      }
    }

    const queryString = existingParams.toString();
    return `${path}${queryString ? '?' + queryString : ''}`;
  }

  /**
   * Generate an href string (with leading #) for an <a> link, preserving the
   * current URL param signal values for the target route pattern.
   *
   * Usage in templates: `<a [href]="routingService.hrefWithParams('/members')">`
   */
  hrefWithParams(basePath: string): string {
    const resolved = this.resolveUrlWithParams(basePath);
    return `#${resolved.startsWith('/') ? resolved : '/' + resolved}`;
  }

  /**
   * Generate an href string for a specific View pattern, with strongly typed path variables.
   * Preserves current URL param signals.
   */
  hrefForView<K extends keyof T>(
    view: K,
    ...args: PathVarNames<T[K]> extends never ? [] : [{ [key in PathVarNames<T[K]>]: string }]
  ): string {
    const pattern = this.config.validPathPatterns[view];
    const pathVars = args[0] as { [key: string]: string } | undefined;
    const substParts = pattern.pathParts.map((part) => {
      if (part.startsWith(':')) {
        const paramName = part.substring(1);
        const val = pathVars?.[paramName];
        if (val === undefined) {
          throw new Error(`Missing path variable ${paramName} for view ${String(view)}`);
        }
        return encodeURIComponent(val);
      } else {
        return part;
      }
    });
    const path = substParts.join('/');
    return this.hrefWithParams(path);
  }
}
