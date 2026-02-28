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
  constructor(private router: RoutingService<MyRoutes>) {
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
  public matchedPatternId: WritableSignal<string | null> = signal(null);
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
      const newHash = `${path}${query}`;
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
        return this.signals[patternId].pathVars[
          paramName as keyof T[keyof T]['pathVars'] & string
        ]();
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
      params.set(key, value());
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }

  private handleUrlChange() {
    let hashlessUrlPart = window.location.hash.substring(1);
    if (hashlessUrlPart.startsWith('/')) {
      hashlessUrlPart = hashlessUrlPart.substring(1);
    }
    const match = matchUrl(hashlessUrlPart, this.config.validPathPatterns);
    if (match) {
      this.matchedPatternId.set(match.patternId);
      updateSignalsFromSubsts(
        match.pathParams,
        this.signals[match.patternId].pathVars,
      );
      updateSignalsFromSubsts(
        match.urlParams,
        this.signals[match.patternId].urlParams,
      );
    } else {
      this.matchedPatternId.set(null);
    }
  }

  navigateTo(pathAndParams: string) {
    if (pathAndParams.startsWith('/')) {
      window.location.hash = `#${pathAndParams}`;
    } else {
      window.location.hash = `#/${pathAndParams}`;
    }
  }

  navigateToParts(parts: string[]) {
    this.navigateTo(parts.join('/'));
  }
}
