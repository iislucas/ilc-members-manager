/* stripe.service.ts
 *
 * Thin client wrapper around the Stripe cloud function callables used by the
 * purchase pages: creating checkout sessions, reading a session back, and
 * managing subscription renewal. Types are imported directly from the
 * functions package so the request/response shapes stay in sync with the
 * server.
 *
 * Note there is no method for listing products. The client reads prices from
 * the cached catalogue at /system/stripe-products (see
 * DataManagerService.stripeProducts); no endpoint will hand out the whole
 * Stripe catalogue on request.
 */

import { inject, Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirebaseStateService } from './firebase-state.service';
import {
  CancelSubscriptionRenewalRequest,
  CancelSubscriptionRenewalResult,
  CheckoutSessionSummary,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResult,
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResult,
  GetCheckoutSessionRequest,
  ResumeSubscriptionRenewalRequest,
  ResumeSubscriptionRenewalResult,
} from '../../functions/src/stripe-types';

@Injectable({ providedIn: 'root' })
export class StripeService {
  private firebaseService = inject(FirebaseStateService);
  private functions = getFunctions(this.firebaseService.app);

  /**
   * Create a hosted Stripe Checkout Session for the given price and return the
   * URL to redirect the buyer to. `origin` is the current app origin, used to
   * build the success/cancel return URLs.
   */
  async createCheckoutSession(
    priceId: string,
    origin: string,
    quantity = 1,
    options?: {
      successUrl?: string;
      cancelUrl?: string;
      metadata?: Record<string, string>;
    },
  ): Promise<CreateCheckoutSessionResult> {
    const fn = httpsCallable<
      CreateCheckoutSessionRequest,
      CreateCheckoutSessionResult
    >(this.functions, 'createStripeCheckoutSession');
    const result = await fn({
      priceId,
      origin,
      quantity,
      successUrl: options?.successUrl,
      cancelUrl: options?.cancelUrl,
      metadata: options?.metadata,
    });
    return result.data;
  }

  /** Read back a completed Checkout Session to confirm the order. */
  async getCheckoutSession(sessionId: string): Promise<CheckoutSessionSummary> {
    const fn = httpsCallable<GetCheckoutSessionRequest, CheckoutSessionSummary>(
      this.functions,
      'getStripeCheckoutSession',
    );
    const result = await fn({ sessionId });
    return result.data;
  }

  /** Cancel future auto-renewals for a Stripe subscription. */
  async cancelSubscriptionRenewal(
    subscriptionId: string,
  ): Promise<CancelSubscriptionRenewalResult> {
    const fn = httpsCallable<
      CancelSubscriptionRenewalRequest,
      CancelSubscriptionRenewalResult
    >(this.functions, 'cancelSubscriptionRenewal');
    const result = await fn({ subscriptionId });
    return result.data;
  }

  /** Resume future auto-renewals for a previously cancelled Stripe subscription. */
  async resumeSubscriptionRenewal(
    subscriptionId: string,
  ): Promise<ResumeSubscriptionRenewalResult> {
    const fn = httpsCallable<
      ResumeSubscriptionRenewalRequest,
      ResumeSubscriptionRenewalResult
    >(this.functions, 'resumeSubscriptionRenewal');
    const result = await fn({ subscriptionId });
    return result.data;
  }

  /** Create a Stripe Billing Customer Portal session to manage payment methods / invoices. */
  async createCustomerPortalSession(
    returnUrl: string,
  ): Promise<CreateCustomerPortalSessionResult> {
    const fn = httpsCallable<
      CreateCustomerPortalSessionRequest,
      CreateCustomerPortalSessionResult
    >(this.functions, 'createCustomerPortalSession');
    const result = await fn({ returnUrl });
    return result.data;
  }
}

