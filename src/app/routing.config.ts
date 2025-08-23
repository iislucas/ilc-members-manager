import { InjectionToken } from '@angular/core';

export type PathPatterns = {
  // A unique identifier/name for this path pattern.
  [patternId: string]: {
    // Used for managing the names of pathPatterns and their possible types.
    varMap: {
      [key: string]: string;
    };
    // The path pattern; of the form: ['view', ':viewId', 'member',
    // ':memberId'] Where anything starting with ":" is a variable.
    pathPattern: string[];
    // Possible URL parameter keys. The stuff of the form:
    // url?key=value&key2=value2 etc (this is just the keys)
    urlParamKeys: string[];
  };
};

export interface RoutingConfig<T extends PathPatterns = {}> {
  validPathPatterns: T;
}

// Defines the injection tag (global namespace)
export const ROUTING_CONFIG = new InjectionToken<RoutingConfig>(
  'routing.config'
);

// All URL params for each PathPattern.
export function urlParamsOfPathPatterns(pathPatterns: PathPatterns): {
  [pathId: string]: { [urlParamKey: string]: string };
} {
  const patternUrlParams: {
    [pathId: string]: { [urlParamKey: string]: string };
  } = {};
  for (const pathId of Object.keys(pathPatterns)) {
    patternUrlParams[pathId] = {};
    for (const urlParamKey of pathPatterns[pathId].urlParamKeys) {
      patternUrlParams[pathId][urlParamKey] = '';
    }
  }
  return patternUrlParams;
}

// All Path Params for each PathPattern.
export function pathParamsOfPathPatterns(pathPatterns: PathPatterns): {
  [pathId: string]: { [pathParamKey: string]: string };
} {
  const patternPathParams: {
    [pathId: string]: { [urlParamKey: string]: string };
  } = {};
  for (const pathId of Object.keys(pathPatterns)) {
    patternPathParams[pathId] = {};
    for (const pathParamKey of Object.keys(pathPatterns[pathId].varMap)) {
      patternPathParams[pathId][pathParamKey] = '';
    }
  }
  return patternPathParams;
}
