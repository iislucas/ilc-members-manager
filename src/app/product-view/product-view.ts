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
  effect,
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
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
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
  EventRegistration,
  EventRegistrationStatus,
  getPricingTierKey,
  getVideoDelta,
  IlcEvent,
  isEventPast,
  isVideoIncludedForFree,
  PricingTierType,
  Product,
  RegistrationPaymentMethod,
} from '../../../functions/src/data-model/events';
import { MembershipType } from '../../../functions/src/data-model/members';
import { environment } from '../../environments/environment';

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

  eventId = input<string>('');
  productId = input<string>('');

  // Route pathVars signal
  private routeEventId = this.routingService.signals[Views.EventRegister]?.pathVars?.eventId;

  effectiveEventId = computed(() => {
    return this.eventId() || (this.routeEventId ? this.routeEventId() : '');
  });

  effectiveProductId = computed(() => {
    return this.productId();
  });

  editRegistrationUrl = computed(() => {
    const evId = this.linkedEvent()?.docId || this.effectiveEventId();
    if (evId) {
      return this.routingService.hrefForView(Views.ManageEventRegistration, { eventId: evId });
    }
    return null;
  });

  isLoading = signal(true);
  isSubmitting = signal(false);
  errorMessage = signal<string | null>(null);

  product = signal<Product | null>(null);
  linkedEvent = signal<IlcEvent | null>(null);
  existingRegistration = signal<EventRegistration | null>(null);

  isPastEvent = computed(() => {
    const ev = this.linkedEvent();
    return ev ? isEventPast(ev) : false;
  });

  user = this.firebaseState.user;
  isAdmin = computed(() => this.user()?.isAdmin || false);
  emailNotificationsEnabled = computed(() => Boolean(environment.emailNotificationsEnabled));

  protected readonly AttendeeRole = AttendeeRole;
  protected readonly AttendanceType = AttendanceType;

  // Determine user's eligible default role
  userRole = computed<AttendeeRole>(() => {
    const u = this.user();
    if (!u) return AttendeeRole.NonMember;
    if (u.member?.instructorId) {
      return AttendeeRole.Instructor;
    }
    if (u.member?.memberId || u.member?.docId) {
      return AttendeeRole.Member;
    }
    return AttendeeRole.NonMember;
  });

  // Preselected and locked attendee status based on verified identity
  selectedRole = computed<AttendeeRole>(() => {
    const reg = this.existingRegistration();
    if (reg?.role) return reg.role;
    return this.userRole();
  });

  attendeeStatusLabel = computed(() => {
    switch (this.selectedRole()) {
      case AttendeeRole.Instructor:
        return 'Certified Instructor';
      case AttendeeRole.Member:
        return 'ILC Member';
      case AttendeeRole.NonMember:
      default:
        return 'General Public';
    }
  });

  attendeeStatusSubtitle = computed(() => {
    const u = this.user();
    if (!u) {
      return 'Registering as non-member. Have an account? Log in to access member discounts.';
    }
    switch (this.selectedRole()) {
      case AttendeeRole.Instructor:
        return 'Verified Instructor status applied.';
      case AttendeeRole.Member:
        return 'Active ILC Membership status applied.';
      case AttendeeRole.NonMember:
      default:
        return 'Public rate applied. Want member rates? Join or upgrade your membership.';
    }
  });

  isRoleEligible = computed(() => {
    const p = this.product();
    if (!p) return false;
    const role = this.selectedRole();
    if (role === AttendeeRole.Instructor) return Boolean(p.allowInstructors);
    if (role === AttendeeRole.Member) return Boolean(p.allowMembers || p.allowInstructors);
    return Boolean(p.allowNonMembers);
  });

  // Early-bird calculations
  isEarlyBirdActive = computed(() => {
    const p = this.product();
    if (!p?.hasEarlyBird || !p.earlyBirdDeadline) return false;
    const today = new Date().toISOString().substring(0, 10);
    return today <= p.earlyBirdDeadline;
  });

  earlyBirdDeadlineFormatted = computed(() => {
    const p = this.product();
    if (!p?.earlyBirdDeadline) return '';
    const parts = p.earlyBirdDeadline.split('-');
    if (parts.length !== 3) return p.earlyBirdDeadline;
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  });

  // In-person capacity tracking
  hasInPersonLimit = computed(() => {
    const p = this.product();
    return Boolean(p?.allowInPerson && typeof p.maxInPersonAttendees === 'number' && p.maxInPersonAttendees > 0);
  });

  inPersonSpacesLeft = computed(() => {
    const p = this.product();
    if (!this.hasInPersonLimit() || !p?.maxInPersonAttendees) return null;
    const count = p.inPersonRegistrationsCount || 0;
    return Math.max(0, p.maxInPersonAttendees - count);
  });

  isInPersonSoldOut = computed(() => {
    const left = this.inPersonSpacesLeft();
    return left !== null && left <= 0;
  });

  isPendingInPerson = computed(() => {
    const reg = this.existingRegistration();
    return Boolean(
      reg &&
      (reg.status === EventRegistrationStatus.PendingInPerson ||
       reg.paymentMethod === RegistrationPaymentMethod.InPerson)
    );
  });

  canPayInPerson = computed(() => {
    const p = this.product();
    if (!p?.allowInPerson || !p.allowPayInPerson) return false;
    if (this.isPastEvent()) return false;
    const att = this.selectedAttendance();
    if (att !== AttendanceType.InPerson && att !== AttendanceType.InPersonAndOnline) return false;

    // If already registered and paid online, cannot downgrade to in-person
    const reg = this.existingRegistration();
    if (reg && reg.status === EventRegistrationStatus.Paid) return false;

    // If sold out, only allowed if attendee is already registered in-person
    if (this.isInPersonSoldOut() && !this.isPendingInPerson()) return false;

    return true;
  });

  selectedAttendance = linkedSignal<AttendanceType>(() => {
    const reg = this.existingRegistration();
    const past = this.isPastEvent();
    if (past) return AttendanceType.VideoOnly;

    const p = this.product();
    if (reg) {
      if (reg.attendance === AttendanceType.InPersonAndOnline) {
        return AttendanceType.InPerson;
      }
      return reg.attendance;
    }

    if (!p) return AttendanceType.InPerson;
    if (p.allowInPerson) return AttendanceType.InPerson;
    if (p.allowOnline) return AttendanceType.Online;
    if (p.allowVideoOnly || p.allowVideo) return AttendanceType.VideoOnly;
    return AttendanceType.InPerson;
  });

  includeVideo = linkedSignal<boolean>(() => {
    if (this.isVideoIncludedForFree()) {
      return true;
    }
    const reg = this.existingRegistration();
    if (reg) {
      return Boolean(reg.hasVideoAccess);
    }
    return false;
  });

  // Attendee contact fields
  attendeeName = linkedSignal(() => {
    return this.existingRegistration()?.name || this.user()?.member?.name || '';
  });
  attendeeEmail = linkedSignal(() => {
    return (
      this.existingRegistration()?.email ||
      this.user()?.firebaseUser?.email ||
      this.user()?.member?.emails?.[0] ||
      ''
    );
  });
  attendeePhone = linkedSignal(() => {
    return this.existingRegistration()?.phone || this.user()?.member?.phone || '';
  });
  attendeeNotes = signal('');

  // Amount already paid by existing registration
  amountAlreadyPaid = computed(() => {
    const reg = this.existingRegistration();
    return reg ? (reg.amountPaidCents || 0) / 100 : 0;
  });

  isUpgrade = computed(() => {
    return Boolean(this.existingRegistration());
  });

  currentAttendanceLabel = computed(() => {
    const reg = this.existingRegistration();
    if (!reg) return '';
    switch (reg.attendance) {
      case AttendanceType.InPerson:
        return 'In-Person Attendance';
      case AttendanceType.Online:
        return 'Online (Zoom) Attendance';
      case AttendanceType.InPersonAndOnline:
        return 'In-Person & Online Attendance';
      case AttendanceType.VideoOnly:
        return 'Video Recording Only';
      default:
        return reg.attendance;
    }
  });

  hasFullRegistration = computed(() => {
    const reg = this.existingRegistration();
    const p = this.product();
    if (!reg || !p) return false;

    const hasFullLive =
      reg.attendance === AttendanceType.InPersonAndOnline ||
      (!p.allowOnline && reg.attendance === AttendanceType.InPerson) ||
      (!p.allowInPerson && reg.attendance === AttendanceType.Online);
    const hasVideo = !p.allowVideo || reg.hasVideoAccess === true;

    return Boolean(hasFullLive && hasVideo);
  });

  isCurrentAttendance(attendance: AttendanceType): boolean {
    const reg = this.existingRegistration();
    if (!reg) return false;
    if (reg.attendance === AttendanceType.InPersonAndOnline) {
      return attendance === AttendanceType.InPerson || attendance === AttendanceType.Online;
    }
    return reg.attendance === attendance;
  }

  // Value of current registration entitlements under current pricing
  existingTierPrice = computed(() => {
    const reg = this.existingRegistration();
    const p = this.product();
    if (!reg || !p) return 0;
    if (this.isPendingInPerson()) return 0;

    const role = reg.role || this.selectedRole();
    const attendance =
      reg.attendance === AttendanceType.InPersonAndOnline ? AttendanceType.InPerson : reg.attendance;
    const includeVid = Boolean(reg.hasVideoAccess || this.isVideoIncludedForFree());

    const tierType = this.isEarlyBirdActive() ? PricingTierType.EarlyBird : PricingTierType.Standard;
    let key = getPricingTierKey(role, attendance, includeVid, tierType);
    let tier = p.tiers[key];
    if ((!tier || !tier.enabled) && this.isEarlyBirdActive()) {
      key = getPricingTierKey(role, attendance, includeVid, PricingTierType.Standard);
      tier = p.tiers[key];
    }
    if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      const fallbackKey = getPricingTierKey(AttendeeRole.NonMember, attendance, includeVid, tierType);
      if (p.tiers[fallbackKey]?.enabled) {
        tier = p.tiers[fallbackKey];
      }
    }
    if ((!tier || !tier.enabled) && includeVid) {
      key = getPricingTierKey(role, attendance, false, tierType);
      tier = p.tiers[key];
      if ((!tier || !tier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
        const fallbackKey = getPricingTierKey(AttendeeRole.NonMember, attendance, false, tierType);
        if (p.tiers[fallbackKey]?.enabled) {
          tier = p.tiers[fallbackKey];
        }
      }
    }
    const currentTierPrice = tier && tier.enabled && typeof tier.price === 'number' ? tier.price : 0;
    return Math.max(this.amountAlreadyPaid(), currentTierPrice);
  });

  getAttendanceUpgradeBadge(attendance: AttendanceType): string | null {
    if (!this.isUpgrade()) return null;
    const reg = this.existingRegistration();
    if (!reg) return null;

    if (this.isCurrentAttendance(attendance)) {
      return null;
    }

    const role = this.selectedRole();
    const includeVid =
      attendance === AttendanceType.VideoOnly
        ? true
        : Boolean(reg.hasVideoAccess || this.isVideoIncludedForFree() || this.includeVideo());
    const p = this.product();
    if (!p) return null;

    const tierType = this.isEarlyBirdActive() ? PricingTierType.EarlyBird : PricingTierType.Standard;
    let targetTier = p.tiers[getPricingTierKey(role, attendance, includeVid, tierType)];
    if ((!targetTier || !targetTier.enabled) && this.isEarlyBirdActive()) {
      targetTier = p.tiers[getPricingTierKey(role, attendance, includeVid, PricingTierType.Standard)];
    }
    if ((!targetTier || !targetTier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      const fallbackKey = getPricingTierKey(AttendeeRole.NonMember, attendance, includeVid, tierType);
      if (p.tiers[fallbackKey]?.enabled) {
        targetTier = p.tiers[fallbackKey];
      }
    }
    if ((!targetTier || !targetTier.enabled) && includeVid) {
      targetTier = p.tiers[getPricingTierKey(role, attendance, false, tierType)];
      if ((!targetTier || !targetTier.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
        const fbKey = getPricingTierKey(AttendeeRole.NonMember, attendance, false, tierType);
        if (p.tiers[fbKey]?.enabled) targetTier = p.tiers[fbKey];
      }
    }
    if (!targetTier || !targetTier.enabled) return null;

    const diff = (targetTier.price || 0) - this.existingTierPrice();
    if (diff <= 0) {
      return 'Included';
    }

    const formatted = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
      minimumFractionDigits: diff % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(diff);

    return `+${formatted}`;
  }

  videoDelta = computed(() => {
    const p = this.product();
    if (!p) return 0;
    const role = this.selectedRole();
    const attendance = this.selectedAttendance();
    const tierType = this.isEarlyBirdActive() ? PricingTierType.EarlyBird : PricingTierType.Standard;
    return getVideoDelta(p, role, attendance, tierType);
  });

  isVideoIncludedForFree = computed(() => {
    const p = this.product();
    if (!p) return false;
    const role = this.selectedRole();
    const attendance = this.selectedAttendance();
    const tierType = this.isEarlyBirdActive() ? PricingTierType.EarlyBird : PricingTierType.Standard;
    return isVideoIncludedForFree(p, role, attendance, tierType);
  });

  videoAddonPriceFormatted = computed(() => {
    const p = this.product();
    if (!p) return '';
    const delta = this.videoDelta();
    if (delta <= 0) return '';
    const formatted = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
      minimumFractionDigits: delta % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(delta);
    return `+${formatted}`;
  });

  videoUpgradeDeltaFormatted = computed(() => {
    if (!this.isUpgrade()) return '';
    const reg = this.existingRegistration();
    if (!reg || reg.hasVideoAccess || this.isVideoIncludedForFree()) return '';
    if (this.isPendingInPerson()) {
      return this.videoAddonPriceFormatted();
    }

    const role = this.selectedRole();
    const attendance = this.selectedAttendance();
    const p = this.product();
    if (!p) return '';

    const tierType = this.isEarlyBirdActive() ? PricingTierType.EarlyBird : PricingTierType.Standard;
    let tierWithVideo = p.tiers[getPricingTierKey(role, attendance, true, tierType)];
    if ((!tierWithVideo || !tierWithVideo.enabled) && this.isEarlyBirdActive()) {
      tierWithVideo = p.tiers[getPricingTierKey(role, attendance, true, PricingTierType.Standard)];
    }
    if ((!tierWithVideo || !tierWithVideo.enabled) && (role === AttendeeRole.Member || role === AttendeeRole.Instructor)) {
      const fallbackKey = getPricingTierKey(AttendeeRole.NonMember, attendance, true, tierType);
      if (p.tiers[fallbackKey]?.enabled) {
        tierWithVideo = p.tiers[fallbackKey];
      }
    }
    if (!tierWithVideo || !tierWithVideo.enabled) {
      const delta = this.videoDelta();
      if (delta > 0) {
        const formatted = new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: (p.currency || 'usd').toUpperCase(),
          minimumFractionDigits: delta % 1 === 0 ? 0 : 2,
          maximumFractionDigits: 2,
        }).format(delta);
        return `+${formatted} upgrade`;
      }
      return '';
    }

    const diff = (tierWithVideo.price || 0) - this.existingTierPrice();
    if (diff <= 0) {
      return 'Included';
    }

    return `+${new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
      minimumFractionDigits: diff % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(diff)} upgrade`;
  });

  // Pricing calculations
  getPricingKey(tierType: PricingTierType = PricingTierType.Standard): string {
    const role = this.selectedRole();
    const attendance = this.selectedAttendance();
    const includeVideo =
      this.selectedAttendance() === AttendanceType.VideoOnly
        ? true
        : Boolean(this.isVideoIncludedForFree() || this.includeVideo());
    const p = this.product();

    const primaryKey = getPricingTierKey(role, attendance, includeVideo, tierType);
    if (p && p.tiers[primaryKey]?.enabled) {
      return primaryKey;
    }
    if (role === AttendeeRole.Member || role === AttendeeRole.Instructor) {
      const fallbackKey = getPricingTierKey(AttendeeRole.NonMember, attendance, includeVideo, tierType);
      if (p?.tiers[fallbackKey]?.enabled) {
        return fallbackKey;
      }
    }
    if (includeVideo) {
      const novideoKey = getPricingTierKey(role, attendance, false, tierType);
      if (p && p.tiers[novideoKey]?.enabled) {
        return novideoKey;
      }
      if (role === AttendeeRole.Member || role === AttendeeRole.Instructor) {
        const fallbackNoVidKey = getPricingTierKey(AttendeeRole.NonMember, attendance, false, tierType);
        if (p?.tiers[fallbackNoVidKey]?.enabled) {
          return fallbackNoVidKey;
        }
      }
    }
    return primaryKey;
  }

  currentTierKey = computed(() => {
    const p = this.product();
    if (!p) return '';
    if (this.isEarlyBirdActive()) {
      const earlyBirdKey = this.getPricingKey(PricingTierType.EarlyBird);
      if (p.tiers[earlyBirdKey]?.enabled) {
        return earlyBirdKey;
      }
    }
    return this.getPricingKey(PricingTierType.Standard);
  });

  standardTierKey = computed(() => {
    return this.getPricingKey(PricingTierType.Standard);
  });

  inPersonTierKey = computed(() => {
    const p = this.product();
    if (!p) return '';
    const ipKey = this.getPricingKey(PricingTierType.InPerson);
    if (p.tiers[ipKey]?.enabled) {
      return ipKey;
    }
    return this.standardTierKey();
  });

  currentTier = computed(() => {
    const p = this.product();
    if (!p) return null;
    return p.tiers[this.currentTierKey()] || null;
  });

  standardTier = computed(() => {
    const p = this.product();
    if (!p) return null;
    return p.tiers[this.standardTierKey()] || null;
  });

  inPersonTier = computed(() => {
    const p = this.product();
    if (!p) return null;
    return p.tiers[this.inPersonTierKey()] || null;
  });

  rawPrice = computed(() => {
    return this.currentTier()?.price || 0;
  });

  standardPrice = computed(() => {
    return this.standardTier()?.price || 0;
  });

  hasEarlyBirdSavings = computed(() => {
    return Boolean(this.isEarlyBirdActive() && this.standardPrice() > this.rawPrice());
  });

  earlyBirdSavingsFormatted = computed(() => {
    const p = this.product();
    if (!p || !this.hasEarlyBirdSavings()) return '';
    const savings = this.standardPrice() - this.rawPrice();
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
    }).format(savings);
  });

  standardPriceFormatted = computed(() => {
    const p = this.product();
    if (!p) return '';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
    }).format(this.standardPrice());
  });

  inPersonPriceFormatted = computed(() => {
    const p = this.product();
    const tier = this.inPersonTier();
    if (!p || !tier) return '';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
    }).format(tier.price || 0);
  });

  upgradeDifference = computed(() => {
    if (this.isPendingInPerson()) {
      return this.rawPrice();
    }
    const diff = this.rawPrice() - this.existingTierPrice();
    return Math.round(diff * 100) / 100;
  });

  isFreeUpdate = computed(() => {
    return Boolean(this.isUpgrade() && !this.isPendingInPerson() && this.upgradeDifference() <= 0);
  });

  isTierAvailable = computed(() => {
    if (!this.isRoleEligible()) return false;

    const tier = this.currentTier();
    if (!tier || !tier.enabled) return false;

    // If event is in the past, live attendance is not available
    if (this.isPastEvent() && this.selectedAttendance() !== AttendanceType.VideoOnly) {
      return false;
    }

    // Check capacity for in-person attendance
    if (
      (this.selectedAttendance() === AttendanceType.InPerson ||
       this.selectedAttendance() === AttendanceType.InPersonAndOnline) &&
      this.isInPersonSoldOut() &&
      !this.isPendingInPerson()
    ) {
      return false;
    }

    // If upgrading and there is a balance due (paid upgrade), verify it adds an entitlement
    if (this.isUpgrade() && this.upgradeDifference() > 0) {
      if (this.hasFullRegistration()) {
        return false;
      }
      // If paying an unpaid in-person registration, allow paying online even without extra entitlements!
      if (this.isPendingInPerson()) {
        return true;
      }
      const reg = this.existingRegistration();
      if (reg) {
        const effectiveVideo = this.selectedAttendance() === AttendanceType.VideoOnly ? true : this.includeVideo();
        const addsVideo = Boolean(effectiveVideo && !reg.hasVideoAccess);
        const hadInPerson =
          reg.attendance === AttendanceType.InPerson ||
          reg.attendance === AttendanceType.InPersonAndOnline;
        const hadOnline =
          reg.attendance === AttendanceType.Online ||
          reg.attendance === AttendanceType.InPersonAndOnline;
        const requestingInPerson =
          this.selectedAttendance() === AttendanceType.InPerson ||
          this.selectedAttendance() === AttendanceType.InPersonAndOnline;
        const requestingOnline =
          this.selectedAttendance() === AttendanceType.Online ||
          this.selectedAttendance() === AttendanceType.InPersonAndOnline;
        const addsInPerson = requestingInPerson && !hadInPerson;
        const addsOnline = requestingOnline && !hadOnline;
        const upgradesFromVideoOnly =
          reg.attendance === AttendanceType.VideoOnly &&
          this.selectedAttendance() !== AttendanceType.VideoOnly;

        if (!addsVideo && !addsInPerson && !addsOnline && !upgradesFromVideoOnly) {
          return false;
        }
      }
    }

    return true;
  });

  priceFormatted = computed(() => {
    const p = this.product();
    const tier = this.currentTier();
    if (!p || !tier) return '';
    const displayAmount = this.isUpgrade() ? Math.max(0, this.upgradeDifference()) : tier.price || 0;
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
    }).format(displayAmount);
  });

  originalPriceFormatted = computed(() => {
    const p = this.product();
    const tier = this.currentTier();
    if (!p || !tier) return '';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p.currency || 'usd').toUpperCase(),
    }).format(tier.price || 0);
  });

  amountAlreadyPaidFormatted = computed(() => {
    const p = this.product();
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: (p?.currency || 'usd').toUpperCase(),
    }).format(this.amountAlreadyPaid());
  });

  eventDateDisplay = computed(() => {
    const ev = this.linkedEvent();
    if (!ev) return '';
    return formatDateRange(ev.start, ev.end);
  });

  constructor() {
    // Refresh attendee registration if auth updates after page load
    effect(() => {
      const user = this.firebaseState.user();
      const ev = this.linkedEvent();
      const evId = ev?.docId || this.effectiveEventId();

      if (!user || !evId || this.existingRegistration()) {
        return;
      }
      const memberDocId = user.member?.docId;
      const emails = [user.firebaseUser?.email, ...(user.member?.emails || [])]
        .filter(Boolean)
        .map((e) => (e as string).toLowerCase().trim());

      this.productService
        .getUserRegistrationForEvent(evId, memberDocId, emails)
        .then((reg) => {
          if (reg) {
            this.existingRegistration.set(reg);
          }
        })
        .catch((err) => {
          console.warn('Could not load user registration for event upgrade:', err);
        });
    });
  }

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadProduct();
  }

  async loadProduct() {
    const evId = this.effectiveEventId();
    const prodId = this.effectiveProductId();

    if (!evId && !prodId) {
      this.errorMessage.set('Event or Registration ID is missing.');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      if (evId) {
        const ev = await this.dataService.getEventById(evId);
        if (ev) {
          this.linkedEvent.set(ev);
          if (ev.productId) {
            const prod = await this.productService.getProduct(ev.productId);
            if (prod) this.product.set(prod);
          } else {
            const prod = await this.productService.getProductByEventId(evId);
            if (prod) this.product.set(prod);
          }
        }
      } else if (prodId) {
        const prod = await this.productService.getProduct(prodId);
        if (prod) {
          this.product.set(prod);
          if (prod.eventDocId) {
            const ev = await this.dataService.getEventById(prod.eventDocId);
            if (ev) this.linkedEvent.set(ev);
          }
        }
      }

      // Wait for auth initialization if still in loading state
      if (this.firebaseState.loginStatus() === LoginStatus.FirebaseLoadingStatus) {
        try {
          await this.firebaseState.loggedIn();
        } catch {
          // Ignored if user not logged in
        }
      }

      // Ensure existing registration is resolved before finishing load to prevent flash of scratch prices
      const user = this.firebaseState.user();
      const resolvedEvId = this.linkedEvent()?.docId || evId;
      if (user && resolvedEvId) {
        const memberDocId = user.member?.docId;
        const emails = [user.firebaseUser?.email, ...(user.member?.emails || [])]
          .filter(Boolean)
          .map((e) => (e as string).toLowerCase().trim());
        try {
          const reg = await this.productService.getUserRegistrationForEvent(
            resolvedEvId,
            memberDocId,
            emails,
          );
          if (reg) {
            this.existingRegistration.set(reg);
          }
        } catch (err) {
          console.warn('Could not load user registration for event:', err);
        }
      }

      if (!this.product()) {
        this.errorMessage.set('Registration setup not found for this event.');
      }
    } catch (err) {
      console.error('Error loading registration:', err);
      this.errorMessage.set('Failed to load registration details.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async saveRegistrationUpdate() {
    const prod = this.product();
    const reg = this.existingRegistration();
    if (!prod || !reg) return;

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
      await this.stripeService.updateProductRegistration({
        productId: prod.docId,
        existingRegistrationDocId: reg.docId,
        role: this.selectedRole(),
        attendance: this.selectedAttendance(),
        includeVideo:
          this.selectedAttendance() === AttendanceType.VideoOnly
            ? true
            : Boolean(this.isVideoIncludedForFree() || this.includeVideo()),
        attendeeDetails: {
          name: this.attendeeName().trim(),
          email: this.attendeeEmail().trim().toLowerCase(),
          phone: this.attendeePhone().trim(),
          notes: this.attendeeNotes().trim(),
        },
      });

      this.existingRegistration.set({
        ...reg,
        name: this.attendeeName().trim(),
        email: this.attendeeEmail().trim().toLowerCase(),
        phone: this.attendeePhone().trim(),
        notes: this.attendeeNotes().trim(),
        role: this.selectedRole(),
        attendance: this.selectedAttendance(),
        hasVideoAccess: Boolean(reg.hasVideoAccess || this.isVideoIncludedForFree() || this.includeVideo()),
        lastUpdated: new Date().toISOString(),
      });

      alert('Your registration has been updated successfully.');
      const evId = this.linkedEvent()?.docId || this.effectiveEventId();
      if (evId) {
        this.routingService.navigateToParts(['events', evId]);
      }
    } catch (err: unknown) {
      console.error('Registration update error:', err);
      const msg = err instanceof Error ? err.message : 'Unable to update registration. Please try again.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
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
      const isUpgrade = this.isUpgrade();
      const existingReg = this.existingRegistration();

      const result = await this.stripeService.createProductCheckoutSession({
        productId: prod.docId,
        role: this.selectedRole(),
        attendance: this.selectedAttendance(),
        includeVideo:
          this.selectedAttendance() === AttendanceType.VideoOnly
            ? true
            : Boolean(this.isVideoIncludedForFree() || this.includeVideo()),
        origin: window.location.origin,
        isUpgrade: isUpgrade,
        existingRegistrationDocId: isUpgrade && existingReg ? existingReg.docId : undefined,
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

  async registerInPerson() {
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
      const result = await this.stripeService.registerEventInPerson({
        productId: prod.docId,
        role: this.selectedRole(),
        attendance: this.selectedAttendance(),
        includeVideo:
          this.selectedAttendance() === AttendanceType.VideoOnly
            ? true
            : Boolean(this.isVideoIncludedForFree() || this.includeVideo()),
        attendeeDetails: {
          name: this.attendeeName().trim(),
          email: this.attendeeEmail().trim().toLowerCase(),
          phone: this.attendeePhone().trim(),
          notes: this.attendeeNotes().trim(),
        },
      });

      if (result && result.success && result.registrationDocId) {
        alert('You have successfully registered to pay in person at the event! Your registration is recorded and due upon arrival.');
        const evId = this.linkedEvent()?.docId || this.effectiveEventId();
        if (evId) {
          this.routingService.navigateToParts(['events', evId]);
        }
      } else {
        throw new Error('Failed to complete in-person registration.');
      }
    } catch (err: unknown) {
      console.error('In-person registration error:', err);
      const msg = err instanceof Error ? err.message : 'Unable to complete in-person registration. Please try again.';
      this.errorMessage.set(msg);
    } finally {
      this.isSubmitting.set(false);
    }
  }
}
