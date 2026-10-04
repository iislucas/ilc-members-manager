/* create-vod-checkout-session.spec.ts
 *
 * Unit tests for createVodCheckoutSession Callable Cloud Function,
 * verifying dynamic Stripe line item pricing (price_data) for single videos and series.
 */

import * as admin from 'firebase-admin';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpsError } from 'firebase-functions/v2/https';
import { createVodCheckoutSession } from './create-vod-checkout-session';
import { initVideoItem, VodAccessTier, VodStatus } from '../data-model/vod';
import { initMember } from '../data-model/members';

const mockStripeCheckoutSessionsCreate = vi.fn();
const mockStripeCustomersList = vi.fn();
const mockStripeCustomersCreate = vi.fn();

vi.mock('../stripe-common', () => ({
  stripeSecretKey: 'mock_key',
  getStripeClient: () => ({
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

describe('createVodCheckoutSession', () => {
  let mockDb: any;
  let mockVideos: Record<string, any>;
  let mockMembers: Record<string, any>;
  let mailStatus = 'active';

  const mockExistingMember = {
    ...initMember(),
    docId: 'mem_existing_1',
    memberId: 'US100',
    name: 'Existing Member',
    emails: ['member@example.com'],
  };

  const sampleSingleVideo = {
    ...initVideoItem(),
    docId: 'vid_standalone_1',
    title: 'Standalone Masterclass',
    description: 'A great masterclass video',
    accessTier: VodAccessTier.DirectPurchase,
    priceCents: 2999,
    currency: 'usd',
    isPublished: true,
    vodStatus: VodStatus.Ready,
    thumbnailUrl: 'https://example.com/thumb.jpg',
  };

  const sampleSeriesPart1 = {
    ...initVideoItem(),
    docId: 'vid_series_p1',
    seriesId: 'series_123',
    seriesTitle: 'Complete Tai Chi Series',
    seriesDescription: 'All lessons in the series',
    seriesPartIndex: 1,
    seriesPriceCents: 4999,
    priceCents: 4999,
    currency: 'usd',
    isPublished: true,
    vodStatus: VodStatus.Ready,
    thumbnailUrl: 'https://example.com/series_thumb.jpg',
  };

  const sampleSeriesPart2 = {
    ...initVideoItem(),
    docId: 'vid_series_p2',
    seriesId: 'series_123',
    seriesTitle: 'Complete Tai Chi Series',
    seriesPartIndex: 2,
    seriesPriceCents: 4999,
    priceCents: 4999,
    currency: 'usd',
    isPublished: true,
    vodStatus: VodStatus.Ready,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mailStatus = 'active';
    mockVideos = {
      vid_standalone_1: { ...sampleSingleVideo },
      vid_series_p1: { ...sampleSeriesPart1 },
      vid_series_p2: { ...sampleSeriesPart2 },
    };
    mockMembers = {
      'member@example.com': { ...mockExistingMember },
    };

    mockStripeCheckoutSessionsCreate.mockResolvedValue({
      id: 'cs_vod_test_session',
      url: 'https://checkout.stripe.com/pay/cs_vod_test_session',
    });

    mockStripeCustomersList.mockResolvedValue({ data: [] });
    mockStripeCustomersCreate.mockResolvedValue({ id: 'cus_new_123' });

    mockDb = {
      collection: vi.fn((colName: string) => {
        if (colName === 'videos') {
          return {
            doc: vi.fn((docId: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: Boolean(mockVideos[docId]),
                id: docId,
                data: () => mockVideos[docId],
              }),
            })),
            where: vi.fn((field: string, op: string, val: string) => ({
              get: vi.fn().mockImplementation(() => {
                const matches = Object.entries(mockVideos)
                  .filter(([_, v]) => (field === 'seriesId' ? v.seriesId === val : v.forVodPageId === val))
                  .map(([id, data]) => ({
                    id,
                    data: () => data,
                  }));
                return Promise.resolve({
                  empty: matches.length === 0,
                  docs: matches,
                });
              }),
            })),
          };
        }
        if (colName === 'members') {
          return {
            where: vi.fn(() => ({
              limit: vi.fn(() => ({
                get: vi.fn().mockImplementation(() => {
                  return Promise.resolve({
                    empty: false,
                    docs: [{ id: 'mem_existing_1', data: () => mockExistingMember }],
                  });
                }),
              })),
            })),
            doc: vi.fn((id: string) => ({
              update: vi.fn().mockResolvedValue({}),
            })),
          };
        }
        return {};
      }),
      doc: vi.fn((path: string) => {
        if (path === 'system/mail-settings') {
          return {
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({
                status: mailStatus,
              }),
            }),
          };
        }
        return {
          get: vi.fn().mockResolvedValue({ exists: false }),
        };
      }),
    };

    vi.spyOn(admin, 'firestore').mockReturnValue(mockDb as any);
  });

  it('rejects calls without allowed origin', async () => {
    const req: any = {
      data: {
        origin: 'https://malicious-website.com',
        videoId: 'vid_standalone_1',
      },
    };
    await expect((createVodCheckoutSession as any).run(req)).rejects.toThrowError(
      /A recognised app origin is required/,
    );
  });

  it('rejects calls missing both videoId and seriesId', async () => {
    const req: any = {
      data: {
        origin: 'https://app.iliqchuan.com',
      },
    };
    await expect((createVodCheckoutSession as any).run(req)).rejects.toThrowError(
      /Either videoId or seriesId must be specified/,
    );
  });

  it('creates dynamic checkout session for a single video with price_data', async () => {
    const req: any = {
      data: {
        origin: 'https://app.iliqchuan.com',
        videoId: 'vid_standalone_1',
      },
    };

    const res = await (createVodCheckoutSession as any).run(req);
    expect(res).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_vod_test_session',
      sessionId: 'cs_vod_test_session',
    });

    expect(mockStripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: 'usd',
              unit_amount: 2999,
              product_data: expect.objectContaining({
                name: 'Standalone Masterclass',
                metadata: {
                  source: 'vod_catalog',
                  orderType: 'vod',
                  videoId: 'vid_standalone_1',
                },
              }),
            }),
          }),
        ],
        metadata: expect.objectContaining({
          orderType: 'vod',
          category: 'vod',
          targetType: 'video',
          videoId: 'vid_standalone_1',
        }),
      }),
    );
  });

  it('creates dynamic checkout session for a multi-part series with price_data', async () => {
    const req: any = {
      data: {
        origin: 'https://app.iliqchuan.com',
        seriesId: 'series_123',
        videoId: 'vid_series_p1',
      },
    };

    const res = await (createVodCheckoutSession as any).run(req);
    expect(res).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/pay/cs_vod_test_session',
      sessionId: 'cs_vod_test_session',
    });

    expect(mockStripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: 'usd',
              unit_amount: 4999,
              product_data: expect.objectContaining({
                name: 'Complete Tai Chi Series (Full Series)',
                metadata: {
                  source: 'vod_catalog',
                  orderType: 'vod',
                  seriesId: 'series_123',
                  videoId: 'vid_series_p1',
                },
              }),
            }),
          }),
        ],
        metadata: expect.objectContaining({
          orderType: 'vod',
          category: 'vod',
          targetType: 'series',
          seriesId: 'series_123',
          videoId: 'vid_series_p1',
        }),
      }),
    );
  });

  it('rejects series when series price is zero or negative', async () => {
    mockVideos['vid_series_p1'].seriesPriceCents = 0;
    mockVideos['vid_series_p1'].priceCents = 0;

    const req: any = {
      data: {
        origin: 'https://app.iliqchuan.com',
        seriesId: 'series_123',
      },
    };

    await expect((createVodCheckoutSession as any).run(req)).rejects.toThrowError(
      /This series is not currently available for direct purchase/,
    );
  });

  it('rejects video when video is not published', async () => {
    mockVideos['vid_standalone_1'].isPublished = false;

    const req: any = {
      data: {
        origin: 'https://app.iliqchuan.com',
        videoId: 'vid_standalone_1',
      },
    };

    await expect((createVodCheckoutSession as any).run(req)).rejects.toThrowError(
      /This video is not currently published/,
    );
  });

  it('supports gift purchases and records gift metadata', async () => {
    const req: any = {
      data: {
        origin: 'https://app.iliqchuan.com',
        seriesId: 'series_123',
        isGift: true,
        recipientEmail: 'friend@example.com',
        recipientName: 'Friend Name',
        giftMessage: 'Enjoy this series!',
      },
    };

    await (createVodCheckoutSession as any).run(req);

    expect(mockStripeCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          isGift: 'true',
          recipientEmail: 'friend@example.com',
          recipientName: 'Friend Name',
          giftMessage: 'Enjoy this series!',
        }),
      }),
    );
  });

  it('enforces MailSendingStatus.Off constraint for gift purchases', async () => {
    mailStatus = 'off';

    const req: any = {
      data: {
        origin: 'https://app.iliqchuan.com',
        videoId: 'vid_standalone_1',
        isGift: true,
        recipientEmail: 'nonexistent@example.com',
      },
    };

    // Override member query to simulate non-existing member
    mockDb.collection = vi.fn((colName: string) => {
      if (colName === 'members') {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
            })),
          })),
        };
      }
      if (colName === 'videos') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ ...sampleSingleVideo, isPublished: true }),
            }),
          })),
        };
      }
      return {};
    });

    await expect((createVodCheckoutSession as any).run(req)).rejects.toThrowError(
      /Email notifications are currently turned off. Gifts can only be sent to existing member accounts/,
    );
  });
});
