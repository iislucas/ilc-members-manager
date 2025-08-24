import { signal, WritableSignal } from '@angular/core';

export type JustPathPattern<T extends string> = {
  // The path pattern; of the form: ['view', ':viewId', 'member',
  // ':memberId'] Where anything starting with ":" is a variable.
  pathParts: string[];

  // Used for managing the names of pathPatterns and their possible types.
  pathVars: {
    [key in T]: string;
  };
};

export type PathPattern<T1 extends string, T2 extends string> = {
  // The path pattern; of the form: ['view', ':viewId', 'member',
  // ':memberId'] Where anything starting with ":" is a variable.
  pathParts: string[];

  // Used for managing the names of pathPatterns and their possible types.
  pathVars: {
    [key in T1]: string;
  };

  // Possible URL parameter keys. The stuff of the form:
  // url?key=value&key2=value2 etc (this is just the keys)
  urlParams?: {
    [key in T2]: string;
  };
};

// The main type for specifing path patterns in a router.
export type PathPatterns = {
  // A unique identifier/name for each path-pattern.
  [patternId: string]: PathPattern<string, string>;
};

// Small class to hold a type from a string literal.
export class NamedVar<T extends string> {
  constructor(public literal: T) {}
}

// Make URL parameters, creating a narrow appropriate type based on the strings
// in the given list.
export function makeUrlParams<T extends string>(
  urlParamNames: T[]
): {
  [key in T]: string;
} {
  const urlParams: { [key in T]: string } = {} as { [key in T]: string };
  for (const urlParamName of urlParamNames) {
    urlParams[urlParamName] = '';
  }
  return urlParams;
}

// Add URL params to a PathPattern that doesn't have them.
// const foo = makeUrlParams(['a', 'b']); ==> foo: { a: string; b: string; }
export function addUrlParams<T1 extends string, T2 extends string>(
  pathPattern: JustPathPattern<T1>,
  urlParamNames: T2[]
): PathPattern<T1, T2> {
  return { ...pathPattern, urlParams: makeUrlParams(urlParamNames) };
}

// type UrlParamsPatternMakerFn<T1 extends string, T2 extends string> = (
//   names: T2[]
// ) => {
//   pathParts: string[];
//   pathVars: { [key in T1]: string };
//   urlParams: { [key in T2]: string };
// };

// Typing aid to get the right type from multiple NamedVar arguments.
type TemplateArgName<T> = T extends NamedVar<infer Hs> ? Hs : never;

/**
 * Helper functions to make pathPattern using string interpretation:
 * pathPattern`foo/${pv('x')}/bar/${y}` ==>
 * pathVars: { x: '', y: '' }
 * pathParts: ['foo', ':x', 'bar', ':y']
 */
export function pv<T extends string>(s: T): NamedVar<T> {
  return new NamedVar<T>(s);
}
export function pathPattern<Args extends NamedVar<any>[]>(
  strings: TemplateStringsArray,
  ...args: Args
): // : UrlParamsPatternMakerFn<TemplateArgName<(typeof args)[number]>, T2>
JustPathPattern<TemplateArgName<(typeof args)[number]>> {
  const varSet = new Set<TemplateArgName<(typeof args)[number]>>();
  args.forEach((a) => {
    varSet.add(a.literal as TemplateArgName<(typeof args)[number]>);
  });

  const pathVars = {} as {
    [key in TemplateArgName<(typeof args)[number]>]: string;
  };
  for (const v of varSet) {
    pathVars[v] = '';
  }

  const pathParts = strings
    .map((s, i) => {
      if (i >= args.length) {
        return s;
      }
      const a = args[i];
      return s + ':' + a.literal;
    })
    .join('')
    .split('/');

  // TODO: consider if this could work: it would avoid needing outside wrapper
  // for addUrlParams.
  //
  // function pathPatternFromUrlParamNamesFn<T2 extends string>(names: T2[]) {
  //   return {
  //     pathParts,
  //     pathVars,
  //     urlParams: makeUrlParams(names) as { [key in T2]: string },
  //   };
  // }
  // return pathPatternFromUrlParamNamesFn;
  return { pathParts, pathVars };
}

// // All URL params for each PathPattern.
// export function urlParamsOfPathPatterns(patterns: PathPatterns): {
//   [pathId: string]: { [urlParamKey: string]: string };
// } {
//   const patternUrlParams: {
//     [pathId: string]: { [urlParamKey: string]: string };
//   } = {};
//   for (const pathId of Object.keys(patterns)) {
//     patternUrlParams[pathId] = {};
//     for (const urlParamKey of Object.keys(patterns[pathId].urlParams)) {
//       patternUrlParams[pathId][urlParamKey] = '';
//     }
//   }
//   return patternUrlParams;
// }

// // All Path Params for each PathPattern.
// export function pathParamsOfPathPatterns(pathPatterns: PathPatterns): {
//   [pathId: string]: { [pathParamKey: string]: string };
// } {
//   const patternPathParams: {
//     [pathId: string]: { [urlParamKey: string]: string };
//   } = {};
//   for (const pathId of Object.keys(pathPatterns)) {
//     patternPathParams[pathId] = {};
//     for (const pathParamKey of Object.keys(pathPatterns[pathId].pathVars)) {
//       patternPathParams[pathId][pathParamKey] = '';
//     }
//   }
//   return patternPathParams;
// }

// Returns any remaining invalid substitutions.
export function updateSignalsFromSubsts(
  substs: { [key: string]: string },
  signals: { [key: string]: WritableSignal<string> }
): { [key: string]: string } {
  for (const key of Object.keys(signals)) {
    if (substs[key]) {
      signals[key].set(substs[key]);
    } else {
      signals[key].set('');
    }
    delete substs[key];
  }
  // The remaining invalid substitutions
  return substs;
}

export type PathVarSignals<
  T1 extends string,
  T2 extends string,
  T extends PathPattern<T1, T2>
> = {
  [key in keyof T['pathVars']]: WritableSignal<T['pathVars'][key]>;
};

export type UrlParamSignals<
  T1 extends string,
  T2 extends string,
  T extends PathPattern<T1, T2>
> = {
  [key in keyof T['urlParams']]: WritableSignal<T['urlParams'][key]>;
};

export class PatternSignals<T extends PathPattern<string, string>> {
  pathVars: { [key in keyof T['pathVars']]: WritableSignal<string> };
  urlParams: { [key in keyof T['urlParams']]: WritableSignal<string> };

  constructor(pattern: T) {
    this.pathVars = {} as {
      [key in keyof T['pathVars']]: WritableSignal<string>;
    };
    this.urlParams = {} as {
      [key in keyof T['urlParams']]: WritableSignal<string>;
    };
    for (const key of Object.keys(pattern.pathVars)) {
      const typedKey = key as keyof T['pathVars'];
      this.pathVars[typedKey] = signal(pattern.pathVars[key]);
    }
    pattern.urlParams ??= {};
    for (const key of Object.keys(pattern.urlParams)) {
      const typedKey = key as keyof T['urlParams'];
      this.urlParams[typedKey] = signal(pattern.urlParams[key]);
    }
  }
}

// export function validatePaths(
//   paths: string[],
//   signals: { [key: string]: WritableSignal<string> }
// ) {
//   for (const path of paths) {
//     const pathParts = path.split('/');
//     for (const part of pathParts) {
//       if (part.startsWith(':')) {
//         const paramName = part.substring(1);
//         if (!signals[paramName]) {
//           throw new Error(
//             `Path parameter "${paramName}" does not have a corresponding signal.`
//           );
//         }
//       }
//     }
//   }
// }

export function parseUrlParams(hash: string): {
  preParamUrl: string;
  urlParams: { [key: string]: string };
} {
  const [preParamUrl, urlParamsString] = hash.split('?');
  const urlParams: { [key: string]: string } = {};
  if (urlParamsString) {
    const params = new URLSearchParams(urlParamsString);
    params.forEach((value, key) => {
      urlParams[key] = value;
    });
  }
  return { preParamUrl, urlParams };
}

// Returns a set of substitutions for path pattern variables. e.g.
// matchUrlPartsToPathParts(['view', 'a', 'member', 'b'], ['view', ':viewId',
// 'member', ':memberId']) ==> {'viewId': 'a', 'memberId': 'b'} and
// matchUrlPartsToPathParts(['view', 'a', 'member', 'b'], ['func']) ==> null
export function matchUrlPartsToPathParts(
  urlParts: string[],
  pathParts: string[]
): { [key: string]: string } | null {
  if (pathParts.length !== urlParts.length) {
    return null;
  }

  const params: { [key: string]: string } = {};
  for (let i = 0; i < pathParts.length; i++) {
    if (pathParts[i].startsWith(':')) {
      const paramName = pathParts[i].substring(1);
      params[paramName] = urlParts[i];
    } else if (pathParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

export function mergeSubsts(
  mergedSubsts: { [key: string]: string },
  substs: { [key: string]: string }
): { [key: string]: string } {
  for (const key in substs) {
    mergedSubsts[key] = substs[key];
  }
  return mergedSubsts;
}

// Given a URL and a set of pathPatterns, return the first matching
// pattern's substitutions (variables in URLs and params from the URL)
export function matchUrl(
  url: string,
  validPathPatterns: PathPatterns
): {
  patternId: string;
  pathParams: { [key: string]: string };
  urlParams: { [key: string]: string };
} | null {
  const { preParamUrl, urlParams } = parseUrlParams(url);
  const urlParts = preParamUrl.split('/');
  for (const [patternId, pathPattern] of Object.entries(validPathPatterns)) {
    const pathParams = matchUrlPartsToPathParts(
      urlParts,
      pathPattern.pathParts
    );
    if (pathParams) {
      return { patternId, pathParams, urlParams };
    }
  }
  return null;
}
