import {
  Injectable,
  signal,
  WritableSignal,
  Inject,
  computed,
  effect,
} from '@angular/core';
import {
  validatePaths,
  mergeSubsts,
  substsFromUrl,
  updateSignalsFromSubsts,
} from './routing.utils';
import {
  pathParamsOfPathPatterns,
  PathPatterns,
  ROUTING_CONFIG,
  RoutingConfig,
  urlParamsOfPathPatterns,
} from './routing.config';

export type StringSignalStruct<T extends PathPatterns> = {
  [Key in keyof T]: WritableSignal<T[Key]['varMap']>;
};

@Injectable({
  providedIn: 'root',
})
export class RoutingService<T extends PathPatterns> {
  private urlHashPath: WritableSignal<string>;
  public pathParamSignals = {} as StringSignalStruct<T>;
  public urlParamSignals = {} as StringSignalStruct<T>;

  constructor(@Inject(ROUTING_CONFIG) private config: RoutingConfig<T>) {
    this.urlHashPath = signal('');

    const initUrlParams = urlParamsOfPathPatterns(
      this.config.validPathPatterns
    );
    const initPathParams = pathParamsOfPathPatterns(
      this.config.validPathPatterns
    );

    for (const patternId of Object.keys(initUrlParams)) {
      this.urlParamSignals[patternId as keyof T] = signal(
        initUrlParams[patternId]
      );
    }
    for (const patternId in Object.keys(initPathParams)) {
      this.pathParamSignals[patternId as keyof T] = signal(
        initPathParams[patternId]
      );
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
      //
      // const path = this.constructPath();
      // const query = this.constructQuery();
      const newHash = this.urlHashPath();
      if (window.location.hash.substring(1) !== newHash) {
        window.location.hash = newHash;
      }
    });
  }

  // private constructPath(): string {
  //   let path = this.paths[0]; // Assume the first path is the one we want to build
  //   for (const key in this.pathParamSignals) {
  //     path = path.replace(`:${key}`, this.pathParamSignals[key]());
  //   }
  //   return path;
  // }

  // private constructQuery(): string {
  //   const params = new URLSearchParams();
  //   for (const key in this.urlParamSignals) {
  //     const value = this.urlParamSignals[key]();
  //     if (value) {
  //       params.set(key, value);
  //     }
  //   }
  //   const queryString = params.toString();
  //   return queryString ? `?${queryString}` : '';
  // }

  private handleUrlChange() {
    const hashlessUrlPart = window.location.hash.substring(1);
    const substs = substsFromUrl(hashlessUrlPart, this.paths);
    if (substs) {
      updateSignalsFromSubsts(substs.pathParams, this.pathParamSignals);
      updateSignalsFromSubsts(substs.urlParams, this.urlParamSignals);
    } else {
    }
  }
}
