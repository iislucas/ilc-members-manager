import { WritableSignal } from '@angular/core';

export function validatePaths(
  paths: string[],
  signals: { [key: string]: WritableSignal<string> }
) {
  for (const path of paths) {
    const pathParts = path.split('/');
    for (const part of pathParts) {
      if (part.startsWith(':')) {
        const paramName = part.substring(1);
        if (!signals[paramName]) {
          throw new Error(
            `Path parameter "${paramName}" does not have a corresponding signal.`
          );
        }
      }
    }
  }
}

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

// Given a URL and a set of valid paths, return the first matching
// substitutions (variables in URLs and params from the URL)
export function substsFromUrl(
  url: string,
  validPathPatterns: string[]
): {
  pathParams: { [key: string]: string };
  urlParams: { [key: string]: string };
} | null {
  const { preParamUrl, urlParams } = parseUrlParams(url);
  const urlParts = preParamUrl.split('/');
  for (const pathPattern of validPathPatterns) {
    const subsitutions: { [key: string]: string } = {};
    const pathParts = pathPattern.split('/');
    const pathParams = matchUrlPartsToPathParts(urlParts, pathParts);
    if (pathParams) {
      return { pathParams, urlParams };
    }
  }
  return null;
}

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
