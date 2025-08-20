import { signal, WritableSignal } from '@angular/core';
import { validatePaths, parseUrl, updateSignalsFromUrl } from './routing.utils';

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

  describe('parseUrl', () => {
    it('should parse a URL with no query parameters', () => {
      const { url, urlParams } = parseUrl('members/123/edit');
      expect(url).toBe('members/123/edit');
      expect(urlParams).toEqual({});
    });

    it('should parse a URL with query parameters', () => {
      const { url, urlParams } = parseUrl('members/123/edit?foo=bar&baz=qux');
      expect(url).toBe('members/123/edit');
      expect(urlParams).toEqual({ foo: 'bar', baz: 'qux' });
    });
  });

  describe('updateSignalsFromUrl', () => {
    let signals: { [key: string]: WritableSignal<string> };
    let paths: string[];

    beforeEach(() => {
      signals = {
        memberId: signal(''),
        view: signal(''),
      };
      paths = ['members/:memberId/:view', 'members/:memberId', 'members'];
    });

    it('should update signals from path parameters', () => {
      const url = 'members/123/edit';
      const urlParams = {};
      updateSignalsFromUrl(url, paths, signals, urlParams);
      expect(signals['memberId']()).toBe('123');
      expect(signals['view']()).toBe('edit');
    });

    it('should update signals from URL parameters', () => {
      const url = 'members';
      const urlParams = { memberId: '456', view: 'list' };
      updateSignalsFromUrl(url, paths, signals, urlParams);
      expect(signals['memberId']()).toBe('456');
      expect(signals['view']()).toBe('list');
    });

    it('should prioritize path parameters over URL parameters', () => {
      const url = 'members/123/edit';
      const urlParams = { memberId: '456', view: 'list' };
      updateSignalsFromUrl(url, paths, signals, urlParams);
      expect(signals['memberId']()).toBe('123');
      expect(signals['view']()).toBe('edit');
    });

    it('should return the path parameters', () => {
      const url = 'members/123/edit';
      const urlParams = {};
      const pathParams = updateSignalsFromUrl(url, paths, signals, urlParams);
      expect(pathParams).toEqual({ memberId: '123', view: 'edit' });
    });

    it('should return null if no path matches', () => {
      const url = 'non-existent-path';
      const urlParams = {};
      const pathParams = updateSignalsFromUrl(url, paths, signals, urlParams);
      expect(pathParams).toBeNull();
    });
  });
});
