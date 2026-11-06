import { describe, expect, it } from 'vitest';
import {
  buildAuthCompleteActionUrl,
  EmailLinkIntent,
  sanitizeInternalReturnPath,
  upgradeLegacyEmailLinkUrl,
} from './auth-link-return';

describe('auth-link-return', () => {
  describe('sanitizeInternalReturnPath', () => {
    it('accepts clean internal paths and query parameters', () => {
      expect(sanitizeInternalReturnPath('/become-a-member')).toBe('become-a-member');
      expect(sanitizeInternalReturnPath('events/E123/register?tier=early')).toBe(
        'events/E123/register?tier=early',
      );
    });

    it('normalizes root, login, and auth/complete to empty string (Home)', () => {
      expect(sanitizeInternalReturnPath('')).toBe('');
      expect(sanitizeInternalReturnPath('/')).toBe('');
      expect(sanitizeInternalReturnPath('/login')).toBe('');
      expect(sanitizeInternalReturnPath('/auth/complete')).toBe('');
    });

    it('rejects open-redirect payloads (external origins, protocol-relative, schemes, backslashes)', () => {
      expect(sanitizeInternalReturnPath('https://evil.example/phish')).toBe('');
      expect(sanitizeInternalReturnPath('//evil.example/phish')).toBe('');
      expect(sanitizeInternalReturnPath('/\\evil.example/phish')).toBe('');
      expect(sanitizeInternalReturnPath('javascript:alert(1)')).toBe('');
      expect(sanitizeInternalReturnPath('data:text/html,<script>alert(1)</script>')).toBe('');
      expect(sanitizeInternalReturnPath('/members\nSet-Cookie: bad')).toBe('');
    });

    it('strips Firebase action parameters from destination paths', () => {
      expect(
        sanitizeInternalReturnPath('/become-a-member?step=2&oobCode=secret&mode=signIn&apiKey=k'),
      ).toBe('become-a-member?step=2');
    });
  });

  describe('buildAuthCompleteActionUrl', () => {
    it('points /login (with no returnUrl) to /auth/complete without returnTo', () => {
      expect(buildAuthCompleteActionUrl('https://members.iliqchuan.com/login')).toBe(
        'https://members.iliqchuan.com/auth/complete',
      );
    });

    it('preserves /login?returnUrl=... as returnTo on /auth/complete', () => {
      expect(
        buildAuthCompleteActionUrl(
          'https://members.iliqchuan.com/login?returnUrl=%2Fmy-gradings',
        ),
      ).toBe('https://members.iliqchuan.com/auth/complete?returnTo=%2Fmy-gradings');
    });

    it('captures a purchase page path as returnTo and appends intent=reset-password when resetting', () => {
      expect(
        buildAuthCompleteActionUrl(
          'https://members.iliqchuan.com/become-a-member?step=1',
          EmailLinkIntent.ResetPassword,
        ),
      ).toBe(
        'https://members.iliqchuan.com/auth/complete?returnTo=%2Fbecome-a-member%3Fstep%3D1&intent=reset-password',
      );
    });

    it('discards unsafe returnUrl values when building action URL', () => {
      expect(
        buildAuthCompleteActionUrl(
          'https://members.iliqchuan.com/login?returnUrl=https%3A%2F%2Fevil.example',
        ),
      ).toBe('https://members.iliqchuan.com/auth/complete');
    });
  });

  describe('upgradeLegacyEmailLinkUrl', () => {
    it('rewrites legacy /login?oobCode=...&mode=signIn onto /auth/complete', () => {
      expect(
        upgradeLegacyEmailLinkUrl(
          'https://members.iliqchuan.com/login?apiKey=key1&oobCode=code123&mode=signIn&lang=en',
        ),
      ).toBe('/auth/complete?apiKey=key1&oobCode=code123&mode=signIn&lang=en');
    });

    it('preserves purchase page returnTo when upgrading legacy link', () => {
      expect(
        upgradeLegacyEmailLinkUrl(
          'https://members.iliqchuan.com/next-grading?apiKey=k&oobCode=c&mode=signIn',
        ),
      ).toBe('/auth/complete?returnTo=%2Fnext-grading&apiKey=k&oobCode=c&mode=signIn');
    });

    it('returns null when already on /auth/complete or when URL is not an email sign-in link', () => {
      expect(
        upgradeLegacyEmailLinkUrl(
          'https://members.iliqchuan.com/auth/complete?apiKey=k&oobCode=c&mode=signIn',
        ),
      ).toBeNull();
      expect(upgradeLegacyEmailLinkUrl('https://members.iliqchuan.com/events')).toBeNull();
    });
  });
});
