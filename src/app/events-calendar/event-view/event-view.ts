/* event-view.ts
 *
 * Component for viewing the full details of a single event.
 * Loads the event by docId from the /events collection.
 */

import { Component, computed, effect, inject, input, OnInit, output, signal } from '@angular/core';
import { formatDateRange } from '../format-date-range';
import { marked } from 'marked';
import { RoutingService } from '../../routing.service';
import { AppPathPatterns, Views } from '../../app.config';
import { IconComponent } from '../../icons/icon.component';
import { SpinnerComponent } from '../../spinner/spinner.component';
import { IlcEvent, EventStatus, eventStatusLabel, initEvent, eventContacts, EventRegistration, Product, isEventPast, AttendanceType } from '../../../../functions/src/data-model/events';
import { FirebaseStateService } from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { ProductService } from '../../product.service';
import { MarkdownViewer } from '../../markdown-editor/markdown-viewer';

@Component({
  selector: 'app-event-view',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, MarkdownViewer],
  templateUrl: './event-view.html',
  styleUrl: './event-view.scss',
})
export class EventViewComponent implements OnInit {
  routingService = inject(RoutingService<AppPathPatterns>);
  firebaseState = inject(FirebaseStateService);
  private dataService = inject(DataManagerService);
  protected productService = inject(ProductService);

  eventId = input.required<string>();
  titleLoaded = output<string>();

  event = signal<IlcEvent | null>(null);
  product = signal<Product | null>(null);
  registration = signal<EventRegistration | null>(null);
  registrationCount = signal<number>(0);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);
  imageLoaded = signal(false);

  hasPaidRegistration = computed(() => !!this.registration());

  productEditUrl = computed(() => {
    const ev = this.event();
    const eventId = this.eventId();
    if (!ev?.productId) return null;
    return this.routingService.hrefForView(Views.ManageEventRegistration, { eventId });
  });

  getProductPriceRange(product: Product): string {
    const enabledTiers = Object.values(product.tiers || {}).filter((t) => t.enabled && t.price > 0);
    if (enabledTiers.length === 0) return 'Free / Custom';
    const prices = enabledTiers.map((t) => t.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const currency = (product.currency || 'usd').toUpperCase();
    if (min === max) {
      return `${min.toFixed(2)} ${currency}`;
    }
    return `${min.toFixed(2)} – ${max.toFixed(2)} ${currency}`;
  }

  canAccessInPerson = computed(() => {
    if (this.canEdit()) return true;
    const reg = this.registration();
    return reg
      ? reg.attendance === AttendanceType.InPerson || reg.attendance === AttendanceType.InPersonAndOnline
      : false;
  });

  canAccessOnline = computed(() => {
    if (this.canEdit()) return true;
    const reg = this.registration();
    return reg
      ? reg.attendance === AttendanceType.Online || reg.attendance === AttendanceType.InPersonAndOnline
      : false;
  });

  canAccessRegistrationDetails = computed(() => {
    if (this.canEdit()) return true;
    return Boolean(this.registration());
  });

  canAccessVideo = computed(() => {
    if (this.canEdit()) return true;
    const reg = this.registration();
    return reg ? reg.hasVideoAccess : false;
  });

  isPastEvent = computed(() => isEventPast(this.event()));

  isVideoPurchaseAvailable = computed(() => {
    const prod = this.product();
    return Boolean(prod && (prod.allowVideoOnly || prod.allowVideo));
  });

  isLiveRegistrationOpen = computed(() => {
    return !this.isPastEvent() && Boolean(this.event()?.productId || this.product());
  });

  registrationsUrl = computed(() => {
    return this.routingService.hrefForView(Views.EventRegistrations, { eventId: this.eventId() });
  });

  registerUrl = computed(() => {
    const pId = this.event()?.productId || this.product()?.docId;
    if (!pId) return null;
    return this.routingService.hrefForView(Views.EventRegister, { eventId: this.eventId() });
  });

  effectivePurchaseDetailsMarkdown = computed(() => {
    return this.event()?.purchaseDetailsMarkdown || this.product()?.purchaseDetailsMarkdown || '';
  });

  effectiveInPersonDetailsMarkdown = computed(() => {
    return this.event()?.inPersonDetailsMarkdown || this.product()?.inPersonDetailsMarkdown || '';
  });

  effectiveOnlineJoiningLink = computed(() => {
    return this.event()?.onlineJoiningLink || this.product()?.onlineJoiningLink || '';
  });

  videoWatchUrl = computed(() => {
    const ev = this.event();
    const prod = this.product();
    const vid = ev?.recordedVideoId || prod?.recordedVideoId;
    if (vid) {
      return this.routingService.hrefForView(Views.VideoView, { videoId: vid });
    }
    return ev?.recordedVideoUrl || prod?.recordedVideoUrl || null;
  });

  dateDisplay = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    return formatDateRange(ev.start, ev.end);
  });

  instructorLabel = computed(() => {
    const id = this.event()?.leadingInstructorId;
    if (!id) return '';
    const instructor = this.dataService.instructors.get(id);
    if (instructor) {
      return `${instructor.name} [${id}]`;
    }
    return id;
  });

  instructorLink = computed(() => {
    const ev = this.event();
    const id = ev?.leadingInstructorId;
    if (!id) return '';
    return `/instructors/${encodeURIComponent(id)}`;
  });

  contacts = computed(() => {
    const ev = this.event();
    return ev ? eventContacts(ev) : [];
  });

  instructorProfileLink(instructorId: string): string {
    return instructorId ? `/instructors/${encodeURIComponent(instructorId)}` : '';
  }

  userEmails = computed(() => {
    const user = this.firebaseState.user();
    if (!user) return [];
    const emails = [user.firebaseUser?.email, ...(user.member?.emails || [])];
    return emails.filter(Boolean).map((e) => (e as string).toLowerCase().trim());
  });

  userMemberDocId = computed(() => this.firebaseState.user()?.member?.docId || '');

  isOwner = computed(() => {
    const ev = this.event();
    const docId = this.userMemberDocId();
    const emails = this.userEmails();
    if (!ev) return false;
    if (docId && ev.ownerDocId === docId) return true;
    if (ev.ownerEmails?.some((e) => emails.includes(e.toLowerCase().trim()))) return true;
    return false;
  });

  isManager = computed(() => {
    const ev = this.event();
    const docId = this.userMemberDocId();
    const emails = this.userEmails();
    if (!ev) return false;
    if (docId && ev.managerDocIds?.includes(docId)) return true;
    if (ev.managerEmails?.some((e) => emails.includes(e.toLowerCase().trim()))) return true;
    return false;
  });

  isAdmin = computed(() => this.firebaseState.user()?.isAdmin || false);

  canManage = computed(() => this.isAdmin() || this.isOwner() || this.isManager());
  canEdit = computed(() => this.isAdmin() || this.isOwner() || this.isManager());

  isDraftRestricted = computed(() => {
    const ev = this.event();
    return ev?.status === EventStatus.Draft && !this.canManage();
  });

  statusLabel = computed(() => eventStatusLabel(this.event()?.status));
  statusClass = computed(() => 'event-status-chip status-' + (this.event()?.status || 'proposed'));

  editUrl = computed(() => {
    const view = this.routingService.matchedPatternId();
    const eventId = this.eventId();
    if (view === Views.MyEventView) {
      return this.routingService.hrefForView(Views.MyEventEdit, { eventId });
    }
    if (view === Views.ManageEventView) {
      return this.routingService.hrefForView(Views.ManageEventEdit, { eventId });
    }
    return this.routingService.hrefForView(Views.EventEdit, { eventId });
  });

  constructor() {
    effect(async () => {
      // Re-check registration when auth resolves or changes
      const user = this.firebaseState.user();
      const ev = this.event();
      if (ev) {
        await this.loadUserRegistration(ev);
      }
    });
  }

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadEvent();
  }

  async loadUserRegistration(event: IlcEvent) {
    const eventId = this.eventId();
    const user = this.firebaseState.user();
    const memberDocId = user?.member?.docId;
    const emails = this.userEmails();

    try {
      if (!this.product()) {
        const prod = event.productId
          ? await this.productService.getProduct(event.productId)
          : await this.productService.getProductByEventId(eventId);
        if (prod) this.product.set(prod);
      }

      const reg = await this.productService.getUserRegistrationForEvent(
        eventId,
        memberDocId,
        emails,
      );
      this.registration.set(reg || null);

      if (this.canManage()) {
        const allRegs = await this.productService.getEventRegistrations(eventId);
        this.registrationCount.set(allRegs.length);
      }
    } catch (regErr) {
      console.error('Error checking event registration / product:', regErr);
    }
  }

  async loadEvent() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const eventId = this.eventId();
      const event = await this.dataService.getEventById(eventId);
      if (event) {
        this.event.set(event);
        this.titleLoaded.emit(event.title);
        await this.loadUserRegistration(event);
      } else {
        this.errorMessage.set('Event not found.');
      }
    } catch (error) {
      console.error('Error loading event:', error);
      this.errorMessage.set('Failed to load event details.');
    } finally {
      this.isLoading.set(false);
    }
  }
}
