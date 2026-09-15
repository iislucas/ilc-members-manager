/* stripe-checkout.spec.ts
 *
 * Unit tests for createStripeCheckoutSession Callable Cloud Function,
 * specifically covering gift purchases and MailSendingStatus.Off enforcement.
 */

import * as admin from 'firebase-admin';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { createStripeCheckoutSession } from './stripe-checkout';
import { initMember } from './data-model/members';

const mockStripePricesRetrieve = vi.fn();
const mockStripeCheckoutSessionsCreate = vi.fn();
const mockStripeCustomersList = vi.fn();
const mockStripeCustomersCreate = vi.fn();

vi.mock('./stripe-common', () => ({
  stripeSecretKey: 'mock_key',
  formatLineItemDescription: (desc: string) => desc,
  getStripeClient: () => ({
    prices: {
      retrieve: mockStripePricesRetrieve,
    },
    checkout: {
      sessions: {
        create: mockStripeCheckoutSessionsCreate,
      },
    },
    customers: {
      list: mockStripeCustomersList,
      create: mockStripeCustomersCreate,
    },
  }),
}));

describe('createStripeCheckoutSession - Gifting', () => {
  let mockDb: any;
  let mailStatus = 'active';

  const mockExistingMember = {
    ...initMember(),
    docId: 'mem_existing_1',
    name: 'Existing Member',
    emails: ['member@example.com'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mailStatus = 'active';

    mockStripePricesRetrieve.mockResolvedValue({
      id: 'price_test_123',
      active: true,
      type: 'one_time',
    });

    mockStripeCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_test_session',
      url: 'https://checkout.stripe.com/pay/cs_test_session',
    });

    mockDb = {
      doc: vi.fn((docPath: string) => {
        if (docPath === 'system/mail-settings') {
          return {
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ status: mailStatus }),
            }),
          };
        }
        return {
          get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        };
      }),
      collection: vi.fn((colName: string) => {
        if (colName === 'acl') {
          return {
            doc: vi.fn((email: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: email === 'member@example.com',
                data: () => ({
                  memberDocIds: email === 'member@example.com' ? ['mem_existing_1'] : [],
                }),
              }),
            })),
          };
        }
        if (colName === 'members') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: docId === 'mem_existing_1',
                data: () => mockExistingMember,
              }),
            })),
            where: vi.fn((field: string, op: string, val: string) => ({
              limit: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: val !== 'member@example.com',
                  docs: val === 'member@example.com' ? [{ id: 'mem_existing_1', data: () => mockExistingMember }] : [],
                }),
              }),
            })),
          };
        }
        return {};
      }),
    };

    vi.spyOn(admin, 'firestore').mockReturnValue(mockDb as any);
  });

  const makeRequest = (data: any) =>
    ({
      data,
      rawRequest: {} as any,
      accepts: () => true,
    }) as unknown as import('firebase-functions/v2/https').CallableRequest<any>;

  it('successfully creates checkout session for gift purchase when mail is active', async () => {
    mailStatus = 'active';
    const req = makeRequest({
      priceId: 'price_test_123',
      origin: 'https://app.iliqchuan.com',
      isGift: true,
      recipientEmail: 'newfriend@example.com',
      recipientName: 'Friend Name',
      giftMessage: 'Enjoy this video!',
    });

    const result = await (createStripeCheckoutSession as any).run(req);

    expect(result.sessionId).toBe('cs_test_session');
    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_session');

    expect(mockStripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          isGift: 'true',
          recipientEmail: 'newfriend@example.com',
          recipientName: 'Friend Name',
          giftMessage: 'Enjoy this video!',
        }),
      }),
    );
  });

  it('rejects gift purchase to non-member when mail status is off', async () => {
    mailStatus = 'off';
    const req = makeRequest({
      priceId: 'price_test_123',
      origin: 'https://app.iliqchuan.com',
      isGift: true,
      recipientEmail: 'unregistered@example.com',
    });

    await expect((createStripeCheckoutSession as any).run(req)).rejects.toThrowError(
      'Email notifications are currently turned off. Gifts can only be sent to existing member accounts.',
    );
  });

  it('allows gift purchase to existing member account when mail status is off', async () => {
    mailStatus = 'off';
    const req = makeRequest({
      priceId: 'price_test_123',
      origin: 'https://app.iliqchuan.com',
      isGift: true,
      recipientEmail: 'member@example.com',
    });

    const result = await (createStripeCheckoutSession as any).run(req);

    expect(result.sessionId).toBe('cs_test_session');
    expect(mockStripeCheckoutSessionsCreate).toHaveBeenCalled();
  });
});
