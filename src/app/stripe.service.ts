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
import { NetworkStateService } from './network-state.service';
import {
  CancelSubscriptionRenewalRequest,
  CancelSubscriptionRenewalResult,
  CheckoutSessionSummary,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResult,
  CreateCustomerPortalSessionRequest,
  CreateCustomerPortalSessionResult,
  CreateSubscriptionPaymentMethodSessionRequest,
  CreateSubscriptionPaymentMethodSessionResult,
  CreateGradingCheckoutSessionRequest,
  CreateProductCheckoutSessionRequest,
  CreateVodCheckoutSessionRequest,
  GetCheckoutSessionRequest,
  GetManagedSchoolsBillingResult,
  RemoveSubscriptionPaymentMethodRequest,
  RemoveSubscriptionPaymentMethodResult,
  ResumeSubscriptionRenewalRequest,
  ResumeSubscriptionRenewalResult,
  UpdateSubscriptionRenewalDateRequest,
  UpdateSubscriptionRenewalDateResult,
  UpdateProductRegistrationRequest,
  UpdateProductRegistrationResult,
  RegisterEventInPersonRequest,
  RegisterEventInPersonResult,
  MarkEventRegistrationPaidRequest,
  MarkEventRegistrationPaidResult,
  UnmarkEventRegistrationPaidRequest,
  UnmarkEventRegistrationPaidResult,
  AdminUpdateEventRegistrationRequest,
  AdminUpdateEventRegistrationResult,
} from '../../functions/src/stripe-types';

@Injectable({ providedIn: 'root' })
export class StripeService {
  private firebaseService = inject(FirebaseStateService);
  private networkState = inject(NetworkStateService);
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
      isGift?: boolean;
      recipientEmail?: string;
      recipientName?: string;
      giftMessage?: string;
    },
  ): Promise<CreateCheckoutSessionResult> {
    if (this.networkState.isOffline()) {
      throw new Error('You are currently offline. Please connect to the internet to complete purchase.');
    }
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
      isGift: options?.isGift,
      recipientEmail: options?.recipientEmail,
      recipientName: options?.recipientName,
      giftMessage: options?.giftMessage,
    });
    return result.data;
  }

  /**
   * Create a Stripe Checkout Session for one or more grading levels. The server
   * checks they are the next levels this member can buy and picks the prices
   * itself; the browser only says which levels it wants.
   */
  async createGradingCheckoutSession(
    request: CreateGradingCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResult> {
    if (this.networkState.isOffline()) {
      throw new Error('You are currently offline. Please connect to the internet to complete purchase.');
    }
    const fn = httpsCallable<
      CreateGradingCheckoutSessionRequest,
      CreateCheckoutSessionResult
    >(this.functions, 'createGradingCheckoutSession');
    const result = await fn(request);
    return result.data;
  }

  /**
   * Create a dynamic Stripe Checkout Session for a class/workshop product.
   */
  async createProductCheckoutSession(
    request: CreateProductCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResult> {
    if (this.networkState.isOffline()) {
      throw new Error('You are currently offline. Please connect to the internet to complete purchase.');
    }
    const fn = httpsCallable<
      CreateProductCheckoutSessionRequest,
      CreateCheckoutSessionResult
    >(this.functions, 'createProductCheckoutSession');
    const result = await fn(request);
    return result.data;
  }

  /**
   * Create a dynamic Stripe Checkout Session for a Video on Demand (VOD) item or series.
   */
  async createVodCheckoutSession(
    request: CreateVodCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResult> {
    if (this.networkState.isOffline()) {
      throw new Error('You are currently offline. Please connect to the internet to complete purchase.');
    }
    const fn = httpsCallable<
      CreateVodCheckoutSessionRequest,
      CreateCheckoutSessionResult
    >(this.functions, 'createVodCheckoutSession');
    const result = await fn(request);
    return result.data;
  }

  /**
   * Update an existing registration when no additional payment is required ($0.00 upgrade / update).
   */
  async updateProductRegistration(
    request: UpdateProductRegistrationRequest,
  ): Promise<UpdateProductRegistrationResult> {
    const fn = httpsCallable<
      UpdateProductRegistrationRequest,
      UpdateProductRegistrationResult
    >(this.functions, 'updateProductRegistration');
    const result = await fn(request);
    return result.data;
  }

  /**
   * Register for an event paying in-person upon arrival (not online with Stripe).
   */
  async registerEventInPerson(
    request: RegisterEventInPersonRequest,
  ): Promise<RegisterEventInPersonResult> {
    const fn = httpsCallable<
      RegisterEventInPersonRequest,
      RegisterEventInPersonResult
    >(this.functions, 'registerEventInPerson');
    const result = await fn(request);
    return result.data;
  }

  /**
   * Mark an in-person event registration as paid at the door (organizer/admin only).
   */
  async markEventRegistrationPaid(
    request: MarkEventRegistrationPaidRequest,
  ): Promise<MarkEventRegistrationPaidResult> {
    const fn = httpsCallable<
      MarkEventRegistrationPaidRequest,
      MarkEventRegistrationPaidResult
    >(this.functions, 'markEventRegistrationPaid');
    const result = await fn(request);
    return result.data;
  }

  /**
   * Unmark an in-person event registration (revert to unpaid / door payment).
   */
  async unmarkEventRegistrationPaid(
    request: UnmarkEventRegistrationPaidRequest,
  ): Promise<UnmarkEventRegistrationPaidResult> {
    const fn = httpsCallable<
      UnmarkEventRegistrationPaidRequest,
      UnmarkEventRegistrationPaidResult
    >(this.functions, 'unmarkEventRegistrationPaid');
    const result = await fn(request);
    return result.data;
  }

  /**
   * Update all editable fields of an event registration (HQ Admin only).
   */
  async adminUpdateEventRegistration(
    request: AdminUpdateEventRegistrationRequest,
  ): Promise<AdminUpdateEventRegistrationResult> {
    if (this.networkState.isOffline()) {
      throw new Error('You are currently offline. Please connect to the internet to save registration changes.');
    }
    const fn = httpsCallable<
      AdminUpdateEventRegistrationRequest,
      AdminUpdateEventRegistrationResult
    >(this.functions, 'adminUpdateEventRegistration');
    const result = await fn(request);
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

  /** Reschedule the next auto-renewal charge date for a Stripe subscription. */
  async updateSubscriptionRenewalDate(
    subscriptionId: string,
    renewalDate: string,
  ): Promise<UpdateSubscriptionRenewalDateResult> {
    if (this.networkState.isOffline()) {
      throw new Error(
        'You are currently offline. Please connect to the internet to update your renewal date.',
      );
    }
    const fn = httpsCallable<
      UpdateSubscriptionRenewalDateRequest,
      UpdateSubscriptionRenewalDateResult
    >(this.functions, 'updateSubscriptionRenewalDate');
    const result = await fn({ subscriptionId, renewalDate });
    return result.data;
  }

  /** Create a hosted Stripe Checkout Setup session to update the payment method for a specific subscription. */
  async createSubscriptionPaymentMethodSession(
    subscriptionId: string,
    returnUrl: string,
  ): Promise<CreateSubscriptionPaymentMethodSessionResult> {
    if (this.networkState.isOffline()) {
      throw new Error(
        'You are currently offline. Please connect to the internet to update your payment method.',
      );
    }
    const fn = httpsCallable<
      CreateSubscriptionPaymentMethodSessionRequest,
      CreateSubscriptionPaymentMethodSessionResult
    >(this.functions, 'createSubscriptionPaymentMethodSession');
    const result = await fn({ subscriptionId, returnUrl });
    return result.data;
  }

  /** Remove the payment method from a non-renewing subscription and permanently end the Stripe subscription schedule. */
  async removeSubscriptionPaymentMethod(
    subscriptionId: string,
  ): Promise<RemoveSubscriptionPaymentMethodResult> {
    if (this.networkState.isOffline()) {
      throw new Error(
        'You are currently offline. Please connect to the internet to remove your payment method.',
      );
    }
    const fn = httpsCallable<
      RemoveSubscriptionPaymentMethodRequest,
      RemoveSubscriptionPaymentMethodResult
    >(this.functions, 'removeSubscriptionPaymentMethod');
    const result = await fn({ subscriptionId });
    return result.data;
  }

  /** Fetch non-sensitive payer & auto-renewal billing summaries for schools owned or managed by the signed-in user. */
  async getManagedSchoolsBilling(): Promise<GetManagedSchoolsBillingResult> {
    if (this.networkState.isOffline()) {
      return { schools: {} };
    }
    const fn = httpsCallable<
      Record<string, never>,
      GetManagedSchoolsBillingResult
    >(this.functions, 'getManagedSchoolsBilling');
    const result = await fn({});
    return result.data;
  }
}

