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

export function parseUrl(hash: string): {
  url: string;
  urlParams: { [key: string]: string };
} {
  const [url, urlParamsString] = hash.split('?');
  const urlParams: { [key: string]: string } = {};
  if (urlParamsString) {
    const params = new URLSearchParams(urlParamsString);
    params.forEach((value, key) => {
      urlParams[key] = value;
    });
  }
  return { url, urlParams };
}

export function updateSignalsFromUrl(
  url: string,
  paths: string[],
  signals: { [key: string]: WritableSignal<string> },
  urlParams: { [key: string]: string }
): { [key: string]: string } | null {
  const urlParts = url.split('/');

  for (const path of paths) {
    const pathParts = path.split('/');
    if (pathParts.length !== urlParts.length) {
      continue;
    }

    const pathParams: { [key: string]: string } = {};
    let match = true;
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i].startsWith(':')) {
        const paramName = pathParts[i].substring(1);
        pathParams[paramName] = urlParts[i];
      } else if (pathParts[i] !== urlParts[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      for (const key in signals) {
        if (pathParams[key]) {
          signals[key].set(pathParams[key]);
        } else if (urlParams[key]) {
          signals[key].set(urlParams[key]);
        }
      }
      return pathParams;
    }
  }
  return null;
}
