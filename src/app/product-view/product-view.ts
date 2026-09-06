/* product-view.ts
 *
 * Public product registration and payment page.
 * Allows users to choose their attendee role, attendance mode (in-person vs online),
 * and video recording access, with dynamic prices calculated from the product's pricing matrix.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  signal,
  linkedSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import { StripeService } from '../stripe.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownViewer } from '../markdown-editor/markdown-viewer';
import { formatDateRange } from '../events-calendar/format-date-range';
import {
  AttendeeRole,
  AttendanceType,
  getPricingTierKey,
  IlcEvent,
  Product,
  MembershipType,
} from '../../../functions/src/data-model';

@Component({
  selector: 'app-product-view',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent, MarkdownViewer],
  templateUrl: './product-view.html',
  styleUrl: './product-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductViewComponent implements OnInit {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected stripeService = inject(StripeService);
  protected readonly Views = Views;

  productId = input<string>('');

  // Route pathVars signal
  private routeProductId = this.routingService.signals[Views.ProductView]?.pathVars?.productId;

  effectiveProductId = computed(() => {
    return this.productId() || (this.routeProductId ? this.routeProductId() : '');
  });

  isLoading = signal(true);
  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);

  product = signal<Product | null>(null);
  linkedEvent = signal<IlcEvent | null>(null);

  user = this.firebaseState.user;
  isAdmin = computed(() => this.user()?.isAdmin || false);

  // Determine user's eligible default role
  userRole = computed<AttendeeRole>(() => {
    const u = this.user();
    if (!u) return 'non_member';
    if (u.member?.instructorId) {
      return 'instructor';
    }
    if (u.member?.memberId || u.member?.docId) {
      return 'member';
    }
    return 'non_member';
  });

  // Selected options
  selectedRole = linkedSignal<AttendeeRole>(() => {
    const p = this.product();
    const uRole = this.userRole();
    if (!p) return uRole;
    if (uRole === 'instructor' && p.allowInstructors) return 'instructor';
    if (uRole === 'member' && p.allowMembers) return 'member';
    if (p.allowNonMembers) return 'non_member';
    if (p.allowMembers) return 'member';
    if (p.allowInstructors) return 'instructor';
    return 'non_member';
  });

  selectedAttendance = linkedSignal<AttendanceType>(() => {
    const p = this.product();
    if (!p) return 'in_person';
    if (p.allowInPerson) return 'in_person';
    if (p.allowOnline) return 'online';
    if (p.allowVideoOnly) return 'video_only';
    return 'in_person';
  });

  includeVideo = linkedSignal<boolean>(() => false);

  // Attendee contact fields
  attendeeName = linkedSignal(() => this.user()?.member?.name || '');
  attendeeEmail = linkedSignal(() => this.user()?.firebaseUser?.email || this.user()?.member?.emails?.[0] || '');
  attendeePhone = linkedSignal(() => this.user()?.member?.phone || '');
  attendeeNotes = signal('');

  // Pricing calculations
  currentTierKey = computed(() => {
    const role = this.selectedRole();
    const attendance = this.selectedAttendance();
    const includeVideo = this.selectedAttendance() === 'video_only' ? true : this.includeVideo();
    const p = this.product();
    const key = getPricingTierKey(role, attendance, includeVideo);
    if (p && (!p.tiers[key] || !p.tiers[key].enabled) && (role === 'member' || role === 'instructor')) {
      const fallbackKey = getPricingTierKey('non_member', attendance, includeVideo);
      if (p.tiers[fallbackKey]?.enabled) {
        return fallbackKey;
      }
    }
    return key;
  });

  currentTier = computed(() => {
    const p = this.product();
    if (!p) return null;
    return p.tiers[this.currentTierKey()] || null;
  });

  isTierAvailable = computed(() => {
    const tier = this.currentTier();
    return Boolean(tier && tier.enabled);
  });

  priceFormatted = computed(() => {
    const p = this.product();
    const tier = this.currentTier();
    if (!p || !tier) return '';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
    }).format(tier.price || 0);
  });

  eventDateDisplay = computed(() => {
    const ev = this.linkedEvent();
    if (!ev) return '';
    return formatDateRange(ev.start, ev.end);
  });

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadProduct();
  }

  async loadProduct() {
    const id = this.effectiveProductId();
    if (!id) {
      this.errorMessage.set('Product ID is missing.');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const prod = await this.productService.getProduct(id);
      if (!prod) {
        this.errorMessage.set('Product not found.');
      } else {
        this.product.set(prod);
        if (prod.eventDocId) {
          const ev = await this.dataService.getEventById(prod.eventDocId);
          if (ev) this.linkedEvent.set(ev);
        }
      }
    } catch (err) {
      console.error('Error loading product:', err);
      this.errorMessage.set('Failed to load product details.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async proceedToCheckout() {
    const prod = this.product();
    if (!prod) return;

    if (!this.attendeeName().trim()) {
      alert('Please enter the attendee name.');
      return;
    }
    if (!this.attendeeEmail().trim()) {
      alert('Please enter your email address for order confirmation.');
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    try {
      const result = await this.stripeService.createProductCheckoutSession({
        productId: prod.docId,
        role: this.selectedRole(),
        attendance: this.selectedAttendance(),
        includeVideo: this.includeVideo(),
        origin: window.location.origin,
        attendeeDetails: {
          name: this.attendeeName().trim(),
          email: this.attendeeEmail().trim().toLowerCase(),
          phone: this.attendeePhone().trim(),
          notes: this.attendeeNotes().trim(),
        },
      });

      if (result && result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        throw new Error('No checkout URL received from server.');
      }
    } catch (err: unknown) {
      console.error('Checkout error:', err);
      const msg = err instanceof Error ? err.message : 'Unable to initialize checkout. Please try again.';
      this.errorMessage.set(msg);
      this.isSubmitting.set(false);
    }
  }
}
