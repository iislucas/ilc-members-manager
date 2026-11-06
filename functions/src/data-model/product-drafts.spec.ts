/* product-drafts.spec.ts
 *
 * Unit tests for ProductDraft domain helpers, deterministic IDs, and Firestore normalization.
 */

import { describe, expect, it } from 'vitest';
import {
  AttendanceType,
  firestoreDocToProductDraft,
  initEventRegistrationOption,
  initProduct,
  initProductDraft,
  productDraftIdFor,
} from './events';

describe('ProductDraft data model helpers', () => {
  describe('productDraftIdFor', () => {
    it('prefers eventDocId even when productDocId is present or empty', () => {
      expect(productDraftIdFor({ eventDocId: 'ev-123', productDocId: '' })).toBe('event_ev-123');
      expect(productDraftIdFor({ eventDocId: 'ev-123', productDocId: 'prod-999' })).toBe(
        'event_ev-123',
      );
    });

    it('falls back to productDocId for standalone products and standalone_new otherwise', () => {
      expect(productDraftIdFor({ eventDocId: '', productDocId: 'prod-999' })).toBe(
        'product_prod-999',
      );
      expect(productDraftIdFor({ eventDocId: '  ', productDocId: '' })).toBe('standalone_new');
    });
  });

  describe('initProductDraft & firestoreDocToProductDraft', () => {
    it('normalizes emails, timestamps, and nested draftProduct via firestoreDocToProduct', () => {
      const product = initProduct();
      product.title = 'Spring Intensive';
      product.purchaseDetailsMarkdown = 'Zoom link: https://zoom.us/j/123';
      product.pricingRules.registrationOptions = [
        initEventRegistrationOption({
          id: 'online',
          label: 'Online Live',
          attendanceType: AttendanceType.Online,
          priceCents: 15000,
        }),
      ];

      const draft = initProductDraft({
        eventDocId: 'ev-spring',
        productDocId: 'prod-spring',
        baseProductLastUpdated: '2026-04-01T10:00:00.000Z',
        draftProduct: product,
        updatedByEmail: '  Admin.User@ILC.com ',
        updatedByName: 'HQ Admin',
        clientSavedAt: '2026-04-02T12:00:00.000Z',
      });

      expect(draft.docId).toBe('event_ev-spring');
      expect(draft.updatedByEmail).toBe('admin.user@ilc.com');
      expect(draft.draftProduct.docId).toBe('prod-spring');
      expect(draft.draftProduct.eventDocId).toBe('ev-spring');

      const restored = firestoreDocToProductDraft({
        id: 'event_ev-spring',
        data: () => ({
          eventDocId: 'ev-spring',
          productDocId: 'prod-spring',
          baseProductLastUpdated: '2026-04-01T10:00:00.000Z',
          updatedByEmail: 'Admin.User@ILC.com',
          updatedByName: 'HQ Admin',
          clientSavedAt: '2026-04-02T12:00:00.000Z',
          createdAt: '2026-04-02T11:55:00.000Z',
          lastUpdated: {
            toDate: () => new Date('2026-04-02T12:00:05.000Z'),
          },
          draftProduct: {
            title: 'Spring Intensive',
            purchaseDetailsMarkdown: 'Zoom link: https://zoom.us/j/123',
            pricingRules: product.pricingRules,
          },
        }),
      });

      expect(restored.docId).toBe('event_ev-spring');
      expect(restored.updatedByEmail).toBe('admin.user@ilc.com');
      expect(restored.lastUpdated).toBe('2026-04-02T12:00:05.000Z');
      expect(restored.createdAt).toBe('2026-04-02T11:55:00.000Z');
      expect(restored.draftProduct.docId).toBe('prod-spring');
      expect(restored.draftProduct.eventDocId).toBe('ev-spring');
      expect(restored.draftProduct.allowOnline).toBe(true);
      expect(restored.draftProduct.allowInPerson).toBe(false);
      expect(restored.draftProduct.purchaseDetailsMarkdown).toBe(
        'Zoom link: https://zoom.us/j/123',
      );
    });
  });
});
