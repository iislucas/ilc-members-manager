import { InjectionToken } from '@angular/core';

export interface RoutingConfig {
  pathParams: { [key: string]: string };
  urlParams: { [key: string]: string };
  paths: string[];
}

export const ROUTING_CONFIG = new InjectionToken<RoutingConfig>(
  'routing.config'
);
