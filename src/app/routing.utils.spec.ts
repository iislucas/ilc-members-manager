import { signal, WritableSignal } from '@angular/core';
import {
  validatePaths,
  parseUrlParams,
  matchUrlPartsToPathParts,
  mergeSubsts,
  substsFromUrl,
  updateSignalsFromSubsts,
} from './routing.utils';

describe('Routing Utils', () => {
  describe('validatePaths', () => {
    it('should not throw an error if all path parameters have corresponding signals', () => {
      const signals = {
        memberId: signal(''),
        view: signal(''),
      };
      const paths = ['members/:memberId/:view', 'members/:memberId', 'members'];
      expect(() => validatePaths(paths, signals as any)).not.toThrow();
    });

    it('should throw an error if a path parameter does not have a corresponding signal', () => {
      const signals = {
        memberId: signal(''),
      };
      const paths = ['members/:memberId/:view'];
      expect(() => validatePaths(paths, signals as any)).toThrow(
        new Error('Path parameter "view" does not have a corresponding signal.')
      );
    });
  });

  describe('parseUrlParams', () => {
    it('should parse a URL with no query parameters', () => {
      const { preParamUrl, urlParams } = parseUrlParams('members/123/edit');
      expect(preParamUrl).toBe('members/123/edit');
      expect(urlParams).toEqual({});
    });

    it('should parse a URL with query parameters', () => {
      const { preParamUrl, urlParams } = parseUrlParams(
        'members/123/edit?foo=bar&baz=qux'
      );
      expect(preParamUrl).toBe('members/123/edit');
      expect(urlParams).toEqual({ foo: 'bar', baz: 'qux' });
    });
  });

  describe('matchUrlPartsToPathParts', () => {
    it('should return substitutions when parts match', () => {
      const urlParts = ['view', 'a', 'member', 'b'];
      const pathParts = ['view', ':viewId', 'member', ':memberId'];
      const result = matchUrlPartsToPathParts(urlParts, pathParts);
      expect(result).toEqual({ viewId: 'a', memberId: 'b' });
    });

    it('should return null when lengths do not match', () => {
      const urlParts = ['view', 'a', 'member', 'b'];
      const pathParts = ['view', ':viewId', 'member'];
      const result = matchUrlPartsToPathParts(urlParts, pathParts);
      expect(result).toBeNull();
    });

    it('should return null when static parts do not match', () => {
      const urlParts = ['view', 'a', 'member', 'b'];
      const pathParts = ['view', ':viewId', 'somethingelse', ':memberId'];
      const result = matchUrlPartsToPathParts(urlParts, pathParts);
      expect(result).toBeNull();
    });
  });

  describe('mergeSubsts', () => {
    it('should merge two sets of substitutions', () => {
      const merged = { a: '1', b: '2' };
      const subs = { b: '3', c: '4' };
      const result = mergeSubsts(merged, subs);
      expect(result).toEqual({ a: '1', b: '3', c: '4' });
    });
  });

  describe('substsFromUrl', () => {
    it('should return path and url params for a matching url', () => {
      const url = 'members/123/edit?foo=bar';
      const paths = ['members/:memberId/:view', 'members/:memberId', 'members'];
      const result = substsFromUrl(url, paths);
      expect(result).toEqual({
        pathParams: { memberId: '123', view: 'edit' },
        urlParams: { foo: 'bar' },
      });
    });

    it('should return null for a non-matching url', () => {
      const url = 'non-existent/path';
      const paths = ['members/:memberId/:view', 'members/:memberId', 'members'];
      const result = substsFromUrl(url, paths);
      expect(result).toBeNull();
    });
  });

  describe('updateSignalsFromSubsts', () => {
    let signals: { [key: string]: WritableSignal<string> };

    beforeEach(() => {
      signals = {
        memberId: signal(''),
        view: signal(''),
        foo: signal(''),
      };
    });

    it('should update signals from substitutions', () => {
      const substs = { memberId: '123', view: 'edit' };
      updateSignalsFromSubsts(substs, signals);
      expect(signals['memberId']()).toBe('123');
      expect(signals['view']()).toBe('edit');
    });

    it('should clear signals that are not in substitutions', () => {
      signals['foo'].set('bar');
      const substs = { memberId: '123', view: 'edit' };
      updateSignalsFromSubsts(substs, signals);
      expect(signals['foo']()).toBe('');
    });

    it('should return remaining invalid substitutions', () => {
      const substs = {
        memberId: '123',
        view: 'edit',
        invalid: 'param',
      };
      const remaining = updateSignalsFromSubsts(substs, signals);
      expect(remaining).toEqual({ invalid: 'param' });
    });
  });
});
