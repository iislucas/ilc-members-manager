import {
  Injectable,
  signal,
  WritableSignal,
  Inject,
  computed,
  effect,
} from '@angular/core';
import { validatePaths, parseUrl, updateSignalsFromUrl } from './routing.utils';
import { ROUTING_CONFIG, RoutingConfig } from './routing.config';

@Injectable({
  providedIn: 'root',
})
export class RoutingService {
  private url: WritableSignal<string>;
  public pathParamSignals: { [key: string]: WritableSignal<string> } = {};
  public urlParamSignals: { [key: string]: WritableSignal<string> } = {};
  public signals: { [key: string]: WritableSignal<string> };

  private paths: string[];

  constructor(@Inject(ROUTING_CONFIG) private config: RoutingConfig) {
    this.url = signal('');
    this.paths = this.config.paths;

    for (const key in this.config.pathParams) {
      this.pathParamSignals[key] = signal(this.config.pathParams[key]);
    }
    for (const key in config.urlParams) {
      this.urlParamSignals[key] = signal(this.config.urlParams[key]);
    }
    this.signals = { ...this.pathParamSignals, ...this.urlParamSignals };

    validatePaths(this.paths, this.signals);

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
    let path = this.paths[0]; // Assume the first path is the one we want to build
    for (const key in this.pathParamSignals) {
      path = path.replace(`:${key}`, this.pathParamSignals[key]());
    }
    return path;
  }

  private constructQuery(): string {
    const params = new URLSearchParams();
    for (const key in this.urlParamSignals) {
      const value = this.urlParamSignals[key]();
      if (value) {
        params.set(key, value);
      }
    }
    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }

  private handleUrlChange() {
    const hash = window.location.hash.substring(1);
    const { url, urlParams } = parseUrl(hash);
    this.url.set(url);

    updateSignalsFromUrl(url, this.paths, this.signals, urlParams);
  }
}
