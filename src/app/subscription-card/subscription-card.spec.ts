import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionCardComponent } from './subscription-card';
import {
  DisplaySubscriptionCard,
  SubscriptionCardCategory,
  SubscriptionCardStatus,
} from './subscription-card.model';
import { StripeService } from '../stripe.service';
import { NetworkStateService } from '../network-state.service';

describe('SubscriptionCardComponent', () => {
  let fixture: ComponentFixture<SubscriptionCardComponent>;
  let component: SubscriptionCardComponent;
  let mockStripeService: {
    cancelSubscriptionRenewal: ReturnType<typeof vi.fn>;
    resumeSubscriptionRenewal: ReturnType<typeof vi.fn>;
    updateSubscriptionRenewalDate: ReturnType<typeof vi.fn>;
    createSubscriptionPaymentMethodSession: ReturnType<typeof vi.fn>;
  };

  const activeAutoRenewCard: DisplaySubscriptionCard = {
    id: 'sub_vid_123',
    subscriptionId: 'sub_vid_123',
    title: 'Class Video Library',
    category: SubscriptionCardCategory.VideoLibrary,
    status: SubscriptionCardStatus.Active,
    statusLabel: 'Active (Auto-Renewing)',
    statusClass: 'status-active',
    expirationDate: '2028-04-23',
    nextAutoRenewDate: '2026-11-15',
    renewalAmountText: '$25.00 USD',
    autoRenewalPaymentText: '2026-11-15 ($25.00 USD)',
    projectedExpirationDate: '2028-05-23',
    interval: 'month',
    isAutoRenewing: true,
    canCancel: true,
    canResume: false,
    canSubscribe: false,
    canEditRenewalDate: true,
    defaultRenewalEditDate: '2028-04-16',
    minRenewalEditDate: '2026-11-02',
    maxRenewalEditDate: '2028-04-23',
    canUpdatePaymentMethod: true,
    paymentMethodSummary: 'Visa •••• 4242',
  };

  beforeEach(async () => {
    mockStripeService = {
      cancelSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_vid_123',
        status: 'active',
        cancelAtPeriodEnd: true,
        periodEnd: '2026-11-15',
      }),
      resumeSubscriptionRenewal: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_vid_123',
        status: 'active',
        cancelAtPeriodEnd: false,
        nextAutoRenewDate: '2026-11-15',
      }),
      updateSubscriptionRenewalDate: vi.fn().mockResolvedValue({
        subscriptionId: 'sub_vid_123',
        status: 'trialing',
        cancelAtPeriodEnd: false,
        nextAutoRenewDate: '2028-04-16',
      }),
      createSubscriptionPaymentMethodSession: vi.fn().mockResolvedValue({
        url: 'https://checkout.stripe.com/c/pay/cs_setup_123',
      }),
    };

    await TestBed.configureTestingModule({
      imports: [SubscriptionCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StripeService, useValue: mockStripeService },
        {
          provide: NetworkStateService,
          useValue: { isOffline: signal(false) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SubscriptionCardComponent);
    component = fixture.componentInstance;
  });

  it('omits "Next auto-renewal payment:" row completely when status is Lifetime', async () => {
    fixture.componentRef.setInput('card', {
      ...activeAutoRenewCard,
      id: 'membership-card',
      subscriptionId: '',
      title: 'ILC Membership',
      category: SubscriptionCardCategory.Membership,
      status: SubscriptionCardStatus.Lifetime,
      statusLabel: 'Lifetime Access',
      expirationDate: 'Never expires',
      nextAutoRenewDate: '',
      renewalAmountText: '',
      autoRenewalPaymentText: '',
      projectedExpirationDate: '',
      isAutoRenewing: false,
      canCancel: false,
      canEditRenewalDate: false,
      canUpdatePaymentMethod: false,
      paymentMethodSummary: undefined,
    } satisfies DisplaySubscriptionCard);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Lifetime Access');
    expect(el.textContent).not.toContain('Next auto-renewal payment:');
    expect(el.textContent).not.toContain('Not applicable');
  });

  it('renders unfolding triangle button on Next auto-renewal payment row and toggles disclosure drawer', async () => {
    fixture.componentRef.setInput('card', activeAutoRenewCard);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const triangleBtn = el.querySelector<HTMLButtonElement>('.renewal-triangle-btn');
    const drawer = el.querySelector<HTMLElement>('.renewal-disclosure-drawer');
    expect(triangleBtn).toBeTruthy();
    expect(triangleBtn?.getAttribute('aria-expanded')).toBe('false');
    expect(drawer?.classList.contains('expanded')).toBe(false);
    expect(el.textContent).toContain('Visa •••• 4242');

    triangleBtn?.click();
    fixture.detectChanges();

    expect(triangleBtn?.getAttribute('aria-expanded')).toBe('true');
    expect(drawer?.classList.contains('expanded')).toBe(true);
    expect(drawer?.textContent).toContain(
      'You will pay $25.00 USD and the expiration date will be extended to 2028-05-23.',
    );
  });

  it('renders "You will pay $0.00 USD..." when renewalAmountText is "$0.00 USD"', async () => {
    fixture.componentRef.setInput('card', {
      ...activeAutoRenewCard,
      nextAutoRenewDate: '2028-03-16',
      renewalAmountText: '$0.00 USD',
      autoRenewalPaymentText: '2028-03-16 ($0.00 USD)',
      projectedExpirationDate: '2028-04-23',
    } satisfies DisplaySubscriptionCard);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('2028-03-16 ($0.00 USD)');
    expect(el.querySelector('.renewal-disclosure-drawer')?.textContent).toContain(
      'You will pay $0.00 USD and the expiration date will be extended to 2028-04-23.',
    );
  });

  it('defaults renewal date editor to 1 week before current expiration date and calls updateSubscriptionRenewalDate', async () => {
    fixture.componentRef.setInput('card', activeAutoRenewCard);
    await fixture.whenStable();
    fixture.detectChanges();

    // Unfold details and open date editor
    component.toggleDetails();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const editBtn = el.querySelector<HTMLButtonElement>('.edit-renewal-trigger');
    expect(editBtn).toBeTruthy();
    editBtn?.click();
    fixture.detectChanges();

    expect(component.editingRenewalDate()).toBe(true);
    expect(component.draftRenewalDate()).toBe('2028-04-16');

    const dateInput = el.querySelector<HTMLInputElement>('.renewal-date-input');
    expect(dateInput?.value).toBe('2028-04-16');
    expect(dateInput?.min).toBe('2026-11-02');
    expect(dateInput?.max).toBe('2028-04-23');
    expect(el.querySelector('.editor-preview')?.textContent).toContain(
      'You will pay $25.00 USD and the expiration date will be extended to 2028-05-23.',
    );

    await component.onSaveRenewalDate();
    fixture.detectChanges();

    expect(mockStripeService.updateSubscriptionRenewalDate).toHaveBeenCalledWith(
      'sub_vid_123',
      '2028-04-16',
    );
    expect(component.editingRenewalDate()).toBe(false);
    expect(component.feedbackMessage()).toContain('2028-04-16');
  });

  it('initiates Stripe setup session and redirects when Update Payment Method is clicked', async () => {
    fixture.componentRef.setInput('card', activeAutoRenewCard);
    await fixture.whenStable();
    fixture.detectChanges();

    const redirectSpy = vi
      .spyOn(component as unknown as { redirectToUrl: (url: string) => void }, 'redirectToUrl')
      .mockImplementation(() => {});

    const el = fixture.nativeElement as HTMLElement;
    const pmBtn = el.querySelector<HTMLButtonElement>('.payment-method-btn');
    expect(pmBtn).toBeTruthy();
    expect(pmBtn?.textContent).toContain('Update Payment Method');

    await component.onUpdatePaymentMethod();

    expect(
      mockStripeService.createSubscriptionPaymentMethodSession,
    ).toHaveBeenCalledWith('sub_vid_123', window.location.href);
    expect(redirectSpy).toHaveBeenCalledWith(
      'https://checkout.stripe.com/c/pay/cs_setup_123',
    );
  });

  it('uses non-blocking inline confirmation instead of window.confirm when cancelling auto-renewal and never puts app-spinner inside button', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    fixture.componentRef.setInput('card', activeAutoRenewCard);
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const cancelBtn = el.querySelector<HTMLButtonElement>('.sub-card-actions .cancel-btn');
    expect(cancelBtn).toBeTruthy();
    cancelBtn?.click();
    fixture.detectChanges();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(component.confirmingCancel()).toBe(true);
    expect(el.querySelector('.inline-confirm-box')).toBeTruthy();
    expect(el.querySelector('button app-spinner')).toBeNull();

    await component.confirmCancelAutoRenew();
    fixture.detectChanges();

    expect(mockStripeService.cancelSubscriptionRenewal).toHaveBeenCalledWith(
      'sub_vid_123',
    );
    expect(component.confirmingCancel()).toBe(false);
    expect(component.feedbackMessage()).toContain('cancelled');
  });
});
