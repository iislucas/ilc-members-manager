import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUnsubscribeRequest, getCategoryLabel, escapeHtml } from './unsubscribe-handler';
import { generateUnsubscribeToken } from './unsubscribe-token';
import { EventDigestFrequency } from './data-model/notifications';
import { TransactionalEmailKey } from './data-model/mail';

const testSecret = '0123456789abcdef0123456789abcdef';

const { mockMemberUpdate, mockMemberDoc, mockDb } = vi.hoisted(() => {
  const mockMemberUpdate = vi.fn().mockResolvedValue(undefined);
  const mockMemberDoc = {
    id: 'mem_123',
    exists: true,
    ref: { update: mockMemberUpdate },
    data: () => ({
      docId: 'mem_123',
      name: 'Test Member',
      emails: ['test@example.com'],
      notificationSettings: {
        eventDigestFrequency: 'weekly',
        emailEnabled: {},
      },
    }),
  };

  const mockDb = {
    collection: vi.fn().mockImplementation((col: string) => {
      if (col === 'members') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(mockMemberDoc),
          }),
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [mockMemberDoc],
              }),
            }),
          }),
        };
      }
      return {};
    }),
    doc: vi.fn().mockImplementation((path: string) => {
      if (path === 'system/mail-settings' || path === 'system/mail-secrets') {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ unsubscribeSecret: '0123456789abcdef0123456789abcdef' }),
          }),
          set: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined),
        };
      }
      return {};
    }),
  };

  return { mockMemberUpdate, mockMemberDoc, mockDb };
});

vi.mock('firebase-admin', () => ({
  firestore: () => mockDb,
}));

describe('unsubscribe-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escapes html entities correctly', () => {
    expect(escapeHtml('<script>alert("xss")&foo</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&amp;foo&lt;/script&gt;',
    );
  });

  it('returns human-readable labels for categories', () => {
    expect(getCategoryLabel('eventDigest')).toBe('Upcoming Events Digest');
    expect(getCategoryLabel(TransactionalEmailKey.OrderConfirmation)).toBe(
      'Order Receipts & Confirmations',
    );
    expect(getCategoryLabel('all')).toBe('All Email Notifications');
  });

  function createMockReqRes(options: {
    method: 'GET' | 'POST';
    query?: Record<string, string>;
    body?: Record<string, string>;
    headers?: Record<string, string>;
  }) {
    const req: any = {
      method: options.method,
      query: options.query || {},
      body: options.body || {},
      headers: options.headers || {},
    };
    const res: any = {
      statusCode: 200,
      body: '',
      status: vi.fn().mockImplementation((code: number) => {
        res.statusCode = code;
        return res;
      }),
      send: vi.fn().mockImplementation((payload: string) => {
        res.body = payload;
        return res;
      }),
    };
    return { req, res };
  }

  it('returns 400 when token is missing', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      query: { mid: 'mem_123' },
    });

    await handleUnsubscribeRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toContain('Invalid Unsubscribe Link');
  });

  it('returns 403 when token is invalid', async () => {
    const { req, res } = createMockReqRes({
      method: 'GET',
      query: { mid: 'mem_123', token: 'invalid-token-12345678901234567' },
    });

    await handleUnsubscribeRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toContain('Invalid or Expired Link');
  });

  it('renders confirmation page on GET request without unsubscribing (anti-scanner protection)', async () => {
    const token = generateUnsubscribeToken('mem_123', testSecret);
    const { req, res } = createMockReqRes({
      method: 'GET',
      query: { mid: 'mem_123', token, kind: 'eventDigest' },
    });

    await handleUnsubscribeRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toContain('Confirm Unsubscribe');
    expect(res.body).toContain('Upcoming Events Digest');
    // Ensure no DB write occurred on GET
    expect(mockMemberUpdate).not.toHaveBeenCalled();
  });

  it('unsubscribes and updates Firestore on POST request', async () => {
    const token = generateUnsubscribeToken('mem_123', testSecret);
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { mid: 'mem_123', token, kind: 'eventDigest' },
    });

    await handleUnsubscribeRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockMemberUpdate).toHaveBeenCalledWith({
      notificationSettings: expect.objectContaining({
        eventDigestFrequency: EventDigestFrequency.None,
      }),
    });
    expect(res.body).toContain('Unsubscribed Successfully');
    expect(res.body).toContain('Undo / Re-subscribe');
  });

  it('handles RFC 8058 automated one-click POST from mail clients', async () => {
    const token = generateUnsubscribeToken('test@example.com', testSecret);
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: {
        email: 'test@example.com',
        token,
        kind: 'eventDigest',
        'List-Unsubscribe': 'One-Click',
      },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'list-unsubscribe': 'One-Click',
      },
    });

    await handleUnsubscribeRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockMemberUpdate).toHaveBeenCalledWith({
      notificationSettings: expect.objectContaining({
        eventDigestFrequency: EventDigestFrequency.None,
      }),
    });
    expect(res.body).toBe('Unsubscribed successfully.');
  });

  it('handles transactional email kind unsubscribe on POST', async () => {
    const token = generateUnsubscribeToken('mem_123', testSecret);
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { mid: 'mem_123', token, kind: TransactionalEmailKey.SubscriptionRenewal },
    });

    await handleUnsubscribeRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockMemberUpdate).toHaveBeenCalledWith({
      notificationSettings: expect.objectContaining({
        emailEnabled: expect.objectContaining({
          [TransactionalEmailKey.SubscriptionRenewal]: false,
        }),
      }),
    });
  });

  it('supports resubscribe action on POST', async () => {
    const token = generateUnsubscribeToken('mem_123', testSecret);
    const { req, res } = createMockReqRes({
      method: 'POST',
      body: { mid: 'mem_123', token, kind: 'eventDigest', action: 'resubscribe' },
    });

    await handleUnsubscribeRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockMemberUpdate).toHaveBeenCalledWith({
      notificationSettings: expect.objectContaining({
        eventDigestFrequency: EventDigestFrequency.Monthly,
      }),
    });
    expect(res.body).toContain('Subscription Restored');
  });
});
