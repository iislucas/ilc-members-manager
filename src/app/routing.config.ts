import { InjectionToken } from '@angular/core';
import { PathPatterns } from './routing.utils';

export interface RoutingConfig<T extends PathPatterns = {}> {
  validPathPatterns: T;
}

// Defines the injection tag (global namespace)
export const ROUTING_CONFIG = new InjectionToken<RoutingConfig>(
  'routing.config'
);
