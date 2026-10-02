import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dns from 'dns';
import * as admin from 'firebase-admin';
import {
  isGoogleWorkspaceDomain,
  clearDomainMxCache,
  checkEmailStatusHandler,
  isCheckEmailRateLimited,
} from './check-email-status';
import { CallableRequest } from 'firebase-functions/v2/https';

describe('check-email-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDomainMxCache();
  });

  describe('isGoogleWorkspaceDomain', () => {
    it('returns true for known consumer domains without querying DNS', async () => {
      const resolveMxSpy = vi.spyOn(dns.promises, 'resolveMx');
      expect(await isGoogleWorkspaceDomain('gmail.com')).toBe(true);
      expect(await isGoogleWorkspaceDomain('googlemail.com')).toBe(true);
      expect(resolveMxSpy).not.toHaveBeenCalled();
    });

    it('returns true when MX exchange points to Google Workspace servers', async () => {
      const resolveMxSpy = vi.spyOn(dns.promises, 'resolveMx').mockResolvedValue([
        { exchange: 'aspmx.l.google.com', priority: 10 },
        { exchange: 'alt1.aspmx.l.google.com', priority: 20 },
      ]);

      const result = await isGoogleWorkspaceDomain('iliqchuan.com');
      expect(result).toBe(true);
      expect(resolveMxSpy).toHaveBeenCalledWith('iliqchuan.com');
    });

    it('returns true when MX exchange points to googlemail or smtp.goog', async () => {
      vi.spyOn(dns.promises, 'resolveMx').mockResolvedValue([
        { exchange: 'aspmx3.googlemail.com', priority: 10 },
      ]);
      expect(await isGoogleWorkspaceDomain('customdomain.org')).toBe(true);

      clearDomainMxCache();
      vi.spyOn(dns.promises, 'resolveMx').mockResolvedValue([
        { exchange: 'inbound.smtp.goog', priority: 10 },
      ]);
      expect(await isGoogleWorkspaceDomain('googledomain.com')).toBe(true);
    });

    it('returns false for non-Google MX records', async () => {
      vi.spyOn(dns.promises, 'resolveMx').mockResolvedValue([
        { exchange: 'mta5.am0.yahoodns.net', priority: 10 },
      ]);
      const result = await isGoogleWorkspaceDomain('yahoo.com');
      expect(result).toBe(false);
    });

    it('caches DNS lookup results for subsequent calls', async () => {
      const resolveMxSpy = vi.spyOn(dns.promises, 'resolveMx').mockResolvedValue([
        { exchange: 'aspmx.l.google.com', priority: 10 },
      ]);

      const first = await isGoogleWorkspaceDomain('iliqchuan.com');
      const second = await isGoogleWorkspaceDomain('iliqchuan.com');

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(resolveMxSpy).toHaveBeenCalledTimes(1);
    });

    it('returns false and logs a warning when DNS query fails', async () => {
      vi.spyOn(dns.promises, 'resolveMx').mockRejectedValue(new Error('queryMx ENODATA'));
      const result = await isGoogleWorkspaceDomain('nodata.example.com');
      expect(result).toBe(false);
    });

    it('returns false when DNS resolution times out', async () => {
      vi.spyOn(dns.promises, 'resolveMx').mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([{ exchange: 'aspmx.l.google.com', priority: 10 }]), 200)),
      );
      const result = await isGoogleWorkspaceDomain('slowdns.example.com', 20);
      expect(result).toBe(false);
    });

    it('returns false for empty or blank domains', async () => {
      expect(await isGoogleWorkspaceDomain('')).toBe(false);
      expect(await isGoogleWorkspaceDomain('   ')).toBe(false);
    });
  });

  describe('checkEmailStatusHandler', () => {
    it('returns empty status when email is not provided', async () => {
      const req = { data: {}, rawRequest: { ip: '1.2.3.4' } } as CallableRequest<{ email: string }>;
      const res = await checkEmailStatusHandler(req);
      expect(res).toEqual({
        hasMemberRecord: false,
        hasAuthAccount: false,
        isGoogleManaged: false,
      });
    });

    it('detects member record from ACL, auth account with password, and Google Workspace domain', async () => {
      vi.spyOn(dns.promises, 'resolveMx').mockResolvedValue([
        { exchange: 'aspmx.l.google.com', priority: 10 },
      ]);

      const mockAclSnap = {
        exists: true,
        data: () => ({ memberDocIds: ['doc_123'] }),
      };
      const mockDoc = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(mockAclSnap),
      });
      const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });
      vi.spyOn(admin, 'firestore').mockReturnValue({ collection: mockCollection } as any);

      vi.spyOn(admin, 'auth').mockReturnValue({
        getUserByEmail: vi.fn().mockResolvedValue({
          providerData: [{ providerId: 'password' }],
          passwordHash: 'hashed',
        }),
      } as any);

      const req = {
        data: { email: 'yen@iliqchuan.com' },
        rawRequest: { ip: '10.0.0.1' },
      } as CallableRequest<{ email: string }>;

      const res = await checkEmailStatusHandler(req);
      expect(res.hasMemberRecord).toBe(true);
      expect(res.hasAuthAccount).toBe(true);
      expect(res.hasPasswordProvider).toBe(true);
      expect(res.hasGoogleProvider).toBe(false);
      expect(res.isGoogleManaged).toBe(true); // From MX record!
    });

    it('sets isGoogleManaged to true if user has google provider even if domain is not google', async () => {
      vi.spyOn(dns.promises, 'resolveMx').mockResolvedValue([
        { exchange: 'mail.yahoo.com', priority: 10 },
      ]);

      const mockAclSnap = { exists: false };
      const mockDoc = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(mockAclSnap),
      });
      const mockQuery = {
        empty: true,
        docs: [],
      };
      const mockWhere = vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(mockQuery),
        }),
      });
      const mockCollection = vi.fn().mockImplementation((name: string) => {
        if (name === 'acl') return { doc: mockDoc };
        return { where: mockWhere };
      });
      vi.spyOn(admin, 'firestore').mockReturnValue({ collection: mockCollection } as any);

      vi.spyOn(admin, 'auth').mockReturnValue({
        getUserByEmail: vi.fn().mockResolvedValue({
          providerData: [{ providerId: 'google.com' }],
        }),
      } as any);

      const req = {
        data: { email: 'student@yahoo.com' },
        rawRequest: { ip: '10.0.0.2' },
      } as CallableRequest<{ email: string }>;

      const res = await checkEmailStatusHandler(req);
      expect(res.hasGoogleProvider).toBe(true);
      expect(res.isGoogleManaged).toBe(true);
    });
  });

  describe('isCheckEmailRateLimited', () => {
    it('allows requests within limit and throttles beyond MAX_REQUESTS_PER_WINDOW', () => {
      const ip = '192.168.1.100';
      const now = 100000;

      for (let i = 0; i < 30; i++) {
        expect(isCheckEmailRateLimited(ip, now + i)).toBe(false);
      }
      // 31st request exceeds rate limit
      expect(isCheckEmailRateLimited(ip, now + 30)).toBe(true);
    });
  });
});
