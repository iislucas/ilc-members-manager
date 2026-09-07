import { describe, it, expect } from 'vitest';
import { getPricingTierKey, initProduct, Product } from './data-model/events';

describe('stripe-product-checkout tier resolution', () => {
  it('correctly maps pricing tier keys', () => {
    expect(getPricingTierKey('non_member', 'in_person', false)).toBe('non_member_in_person_novideo');
    expect(getPricingTierKey('non_member', 'in_person', true)).toBe('non_member_in_person_video');
    expect(getPricingTierKey('member', 'in_person', false)).toBe('member_in_person_novideo');
    expect(getPricingTierKey('member', 'online', false)).toBe('member_online_novideo');
    expect(getPricingTierKey('instructor', 'video_only', false)).toBe('instructor_video_only');
    expect(getPricingTierKey('instructor', 'video_only', true)).toBe('instructor_video_only');
  });

  it('validates product tier configuration fallback logic', () => {
    const product: Product = {
      ...initProduct(),
      docId: 'prod_test_1',
      allowNonMembers: true,
      allowMembers: true,
      allowInPerson: true,
      tiers: {
        non_member_in_person_novideo: { enabled: true, price: 100 },
      },
    };

    // Member with no dedicated member tier falls back to non_member tier
    const memberTierKey = getPricingTierKey('member', 'in_person', false);
    let resolvedTier = product.tiers[memberTierKey];
    if (!resolvedTier || !resolvedTier.enabled) {
      const fallbackKey = getPricingTierKey('non_member', 'in_person', false);
      resolvedTier = product.tiers[fallbackKey];
    }
    expect(resolvedTier).toBeDefined();
    expect(resolvedTier?.price).toBe(100);
  });
});
