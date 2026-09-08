/* product-edit.ts
 *
 * Admin component for creating and editing Class / Workshop products.
 * Provides full control over the pricing matrix across all intersections of
 * member status, instructor status, attendance mode, and video access.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { SearchableSet } from '../searchable-set';
import { AttendeeRole, AttendanceType, getPricingTierKey, IlcEvent, initProduct, PricingTierType, Product } from '../../../functions/src/data-model/events';

@Component({
  selector: 'app-product-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent, MarkdownEditor, AutocompleteComponent],
  templateUrl: './product-edit.html',
  styleUrl: './product-edit.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductEditComponent implements OnInit {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected readonly Views = Views;
  protected readonly AttendeeRole = AttendeeRole;
  protected readonly AttendanceType = AttendanceType;
  protected readonly PricingTierType = PricingTierType;

  productIdInput = input<string>('', { alias: 'productId' });
  embedded = input<boolean>(false);
  embeddedEventDocId = input<string>('');
  embeddedEventTitle = input<string>('');
  embeddedOnlineJoiningLink = input<string>('');
  embeddedPurchaseDetailsMarkdown = input<string>('');
  embeddedInPersonDetailsMarkdown = input<string>('');
  embeddedRecordedVideoId = input<string>('');
  embeddedRecordedVideoUrl = input<string>('');

  productSaved = output<string>();
  editCancelled = output<void>();

  // Route pathVars signal
  private routeEventId = this.routingService.signals[Views.ManageEventRegistration]?.pathVars?.eventId;

  effectiveEventId = computed(() => {
    return this.embeddedEventDocId() || (this.routeEventId ? this.routeEventId() : '');
  });

  effectiveProductId = computed(() => {
    return this.productIdInput();
  });

  isNew = computed(() => !this.productModel().docId);

  isLoading = signal(false);
  isSaving = signal(false);
  errorMessage = signal<string | null>(null);

  // Form Model
  productModel = signal<Product>(initProduct());

  // Special pricing columns
  hasMemberPrice = signal<boolean>(false);
  hasInstructorPrice = signal<boolean>(false);

  // Event autocomplete search
  eventsSearchableSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');
  eventDisplayFns = {
    toChipId: (e: IlcEvent) => e.docId,
    toName: (e: IlcEvent) => `${e.start.substring(0, 10)} — ${e.title}`,
  };

  linkedEvent = computed(() => {
    const id = this.productModel().eventDocId;
    if (!id) return null;
    return this.eventsSearchableSet.get(id) || null;
  });

  // Audience: "anyone" (Anyone / Public >= Members >= Instructors), "members", "instructors"
  registrationAudience = computed<'anyone' | 'members' | 'instructors'>(() => {
    const m = this.productModel();
    if (m.allowNonMembers) return 'anyone';
    if (m.allowMembers) return 'members';
    return 'instructors';
  });

  standardRole = computed<AttendeeRole>(() => {
    const a = this.registrationAudience();
    if (a === 'instructors') return AttendeeRole.Instructor;
    if (a === 'members') return AttendeeRole.Member;
    return AttendeeRole.NonMember;
  });

  standardRoleLabel = computed<string>(() => {
    const a = this.registrationAudience();
    if (a === 'instructors') return 'Instructor Price';
    if (a === 'members') return 'Member Price';
    return 'Standard Price';
  });

  // Delta Pricing Signals
  lateDeltaPrice = signal<number>(0);
  hasDoorDelta = signal<boolean>(false);
  doorDeltaPrice = signal<number>(0);
  videoDeltaPrice = signal<number>(0);

  // Attendance options (simplified base rows of the matrix)
  attendanceRows: {
    attendance: AttendanceType;
    getLabel: (p: Product) => string;
    isAllowed: (p: Product) => boolean;
  }[] = [
    {
      attendance: AttendanceType.InPerson,
      getLabel: (p) => (p.hasEarlyBird ? 'In-Person Attendance (Early-Bird)' : 'In-Person Attendance'),
      isAllowed: (p) => p.allowInPerson,
    },
    {
      attendance: AttendanceType.Online,
      getLabel: (p) => (p.hasEarlyBird ? 'Online Attendance (Early-Bird)' : 'Online Attendance'),
      isAllowed: (p) => p.allowOnline,
    },
    {
      attendance: AttendanceType.VideoOnly,
      getLabel: () => 'Video Recording Only (Pre-order)',
      isAllowed: (p) => Boolean(p.allowVideoOnly),
    },
  ];

  visibleRows = computed(() => {
    const p = this.productModel();
    const active = this.attendanceRows.filter((r) => r.isAllowed(p));
    return active.length > 0 ? active : [this.attendanceRows[0]];
  });

  currencySymbol = computed(() => {
    switch (this.productModel().currency?.toLowerCase()) {
      case 'eur':
        return '€';
      case 'gbp':
        return '£';
      default:
        return '$';
    }
  });

  ngOnInit() {
    if (!this.embedded()) {
      window.scrollTo(0, 0);
    }
    this.loadData();
  }

  async loadData() {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      // 1. Initialize searchable events
      const eventsSnap = await this.dataService.getEvents();
      if (eventsSnap && eventsSnap.length > 0) {
        this.eventsSearchableSet.setEntries(eventsSnap);
      }

      // 2. Load product if editing or event route
      const id = this.effectiveProductId();
      const evId = this.effectiveEventId();

      let existing: Product | undefined;
      if (id) {
        existing = await this.productService.getProduct(id);
      } else if (evId) {
        const ev = await this.dataService.getEventById(evId);
        if (ev?.productId) {
          existing = await this.productService.getProduct(ev.productId);
        } else {
          existing = await this.productService.getProductByEventId(evId);
        }
      }

      if (existing) {
        this.productModel.set(structuredClone(existing));
        this.hasMemberPrice.set(Boolean(existing.hasMemberPrice ?? this.detectHasSpecialPrice(existing, AttendeeRole.Member)));
        this.hasInstructorPrice.set(Boolean(existing.hasInstructorPrice ?? this.detectHasSpecialPrice(existing, AttendeeRole.Instructor)));
        this.lateDeltaPrice.set(existing.lateDeltaPrice ?? 0);
        this.hasDoorDelta.set(Boolean(existing.hasDoorDelta));
        this.doorDeltaPrice.set(existing.doorDeltaPrice ?? 0);
        this.videoDeltaPrice.set(existing.videoDeltaPrice ?? 0);
      } else {
        const newProduct = initProduct();
        if (evId) {
          newProduct.eventDocId = evId;
          const ev = this.eventsSearchableSet.get(evId);
          if (ev && !this.embeddedEventTitle()) {
            newProduct.title = ev.title;
          }
        }
        if (this.embeddedEventDocId()) {
          newProduct.eventDocId = this.embeddedEventDocId();
        }
        if (this.embeddedEventTitle()) {
          newProduct.title = this.embeddedEventTitle();
        }
        if (this.embeddedPurchaseDetailsMarkdown()) {
          newProduct.purchaseDetailsMarkdown = this.embeddedPurchaseDetailsMarkdown();
        } else if (this.embeddedOnlineJoiningLink()) {
          newProduct.purchaseDetailsMarkdown = this.embeddedOnlineJoiningLink();
        }
        if (this.embeddedInPersonDetailsMarkdown()) {
          newProduct.inPersonDetailsMarkdown = this.embeddedInPersonDetailsMarkdown();
        }
        if (this.embeddedRecordedVideoId()) {
          newProduct.recordedVideoId = this.embeddedRecordedVideoId();
        }
        if (this.embeddedRecordedVideoUrl()) {
          newProduct.recordedVideoUrl = this.embeddedRecordedVideoUrl();
        }
        this.productModel.set(newProduct);
        this.hasMemberPrice.set(false);
        this.hasInstructorPrice.set(false);
      }
    } catch (err) {
      console.error('Error loading product data:', err);
      this.errorMessage.set('Failed to load data.');
    } finally {
      this.isLoading.set(false);
    }
  }

  onEventSelected(event: IlcEvent | null) {
    if (!event) return;
    this.productModel.update((m) => ({
      ...m,
      eventDocId: event.docId,
      title: m.title.trim() ? m.title : event.title,
    }));
  }

  clearLinkedEvent() {
    this.productModel.update((m) => ({
      ...m,
      eventDocId: '',
    }));
  }

  setRegistrationAudience(choice: 'anyone' | 'members' | 'instructors') {
    this.productModel.update((m) => {
      switch (choice) {
        case 'anyone':
          return { ...m, allowNonMembers: true, allowMembers: true, allowInstructors: true };
        case 'members':
          return { ...m, allowNonMembers: false, allowMembers: true, allowInstructors: true };
        case 'instructors':
          return { ...m, allowNonMembers: false, allowMembers: false, allowInstructors: true };
      }
    });
  }

  recalculateAllTiers(model: Product): Product {
    const clone = structuredClone(model);
    const roles: AttendeeRole[] = [
      AttendeeRole.NonMember,
      AttendeeRole.Member,
      AttendeeRole.Instructor,
    ];
    const lateDelta = this.lateDeltaPrice();
    const hasDoor = this.hasDoorDelta();
    const doorDelta = this.doorDeltaPrice();
    const videoDelta = this.videoDeltaPrice();

    clone.lateDeltaPrice = lateDelta;
    clone.hasDoorDelta = hasDoor;
    clone.doorDeltaPrice = doorDelta;
    clone.videoDeltaPrice = videoDelta;

    for (const r of roles) {
      // 1. In-Person
      const inPersonBaseKey = clone.hasEarlyBird
        ? getPricingTierKey(r, AttendanceType.InPerson, false, PricingTierType.EarlyBird)
        : getPricingTierKey(r, AttendanceType.InPerson, false, PricingTierType.Standard);
      const inPersonBasePrice = clone.tiers[inPersonBaseKey]?.price ?? 0;

      const inPersonEarlyBirdPrice = inPersonBasePrice;
      const inPersonStandardPrice = inPersonBasePrice + (clone.hasEarlyBird ? lateDelta : 0);
      const inPersonDoorPrice = inPersonStandardPrice + (hasDoor ? doorDelta : 0);

      clone.tiers[getPricingTierKey(r, AttendanceType.InPerson, false, PricingTierType.Standard)] = {
        enabled: true,
        price: inPersonStandardPrice,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.InPerson, true, PricingTierType.Standard)] = {
        enabled: true,
        price: inPersonStandardPrice + videoDelta,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.InPerson, false, PricingTierType.EarlyBird)] = {
        enabled: true,
        price: inPersonEarlyBirdPrice,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.InPerson, true, PricingTierType.EarlyBird)] = {
        enabled: true,
        price: inPersonEarlyBirdPrice + videoDelta,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.InPerson, false, PricingTierType.InPerson)] = {
        enabled: true,
        price: inPersonDoorPrice,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.InPerson, true, PricingTierType.InPerson)] = {
        enabled: true,
        price: inPersonDoorPrice + videoDelta,
      };

      // 2. Online
      const onlineBaseKey = clone.hasEarlyBird
        ? getPricingTierKey(r, AttendanceType.Online, false, PricingTierType.EarlyBird)
        : getPricingTierKey(r, AttendanceType.Online, false, PricingTierType.Standard);
      const onlineBasePrice = clone.tiers[onlineBaseKey]?.price ?? 0;

      const onlineEarlyBirdPrice = onlineBasePrice;
      const onlineStandardPrice = onlineBasePrice + (clone.hasEarlyBird ? lateDelta : 0);

      clone.tiers[getPricingTierKey(r, AttendanceType.Online, false, PricingTierType.Standard)] = {
        enabled: true,
        price: onlineStandardPrice,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.Online, true, PricingTierType.Standard)] = {
        enabled: true,
        price: onlineStandardPrice + videoDelta,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.Online, false, PricingTierType.EarlyBird)] = {
        enabled: true,
        price: onlineEarlyBirdPrice,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.Online, true, PricingTierType.EarlyBird)] = {
        enabled: true,
        price: onlineEarlyBirdPrice + videoDelta,
      };

      // 3. Video-Only
      const videoOnlyBaseKey = clone.hasEarlyBird
        ? getPricingTierKey(r, AttendanceType.VideoOnly, true, PricingTierType.EarlyBird)
        : getPricingTierKey(r, AttendanceType.VideoOnly, true, PricingTierType.Standard);
      const videoOnlyBasePrice = clone.tiers[videoOnlyBaseKey]?.price ?? 0;

      clone.tiers[getPricingTierKey(r, AttendanceType.VideoOnly, true, PricingTierType.Standard)] = {
        enabled: true,
        price: videoOnlyBasePrice,
      };
      clone.tiers[getPricingTierKey(r, AttendanceType.VideoOnly, true, PricingTierType.EarlyBird)] = {
        enabled: true,
        price: videoOnlyBasePrice,
      };
    }

    return clone;
  }

  toggleAttendanceMode(mode: 'in_person' | 'online' | 'video' | 'video_only') {
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      if (mode === 'in_person') clone.allowInPerson = !clone.allowInPerson;
      if (mode === 'online') clone.allowOnline = !clone.allowOnline;
      if (mode === 'video') clone.allowVideo = !clone.allowVideo;
      if (mode === 'video_only') clone.allowVideoOnly = !clone.allowVideoOnly;
      return this.recalculateAllTiers(clone);
    });
  }

  toggleEarlyBird() {
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      clone.hasEarlyBird = !clone.hasEarlyBird;
      return this.recalculateAllTiers(clone);
    });
  }

  updateEarlyBirdDeadline(earlyBirdDeadline: string) {
    this.productModel.update((m) => ({ ...m, earlyBirdDeadline }));
  }

  updateLateDeltaPrice(val: string) {
    const price = parseFloat(val) || 0;
    this.lateDeltaPrice.set(price);
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      clone.lateDeltaPrice = price;
      return this.recalculateAllTiers(clone);
    });
  }

  togglePayInPerson() {
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      clone.allowPayInPerson = !clone.allowPayInPerson;
      return this.recalculateAllTiers(clone);
    });
  }

  toggleDoorDelta() {
    this.hasDoorDelta.update((v) => !v);
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      clone.hasDoorDelta = this.hasDoorDelta();
      return this.recalculateAllTiers(clone);
    });
  }

  updateDoorDeltaPrice(val: string) {
    const price = parseFloat(val) || 0;
    this.doorDeltaPrice.set(price);
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      clone.doorDeltaPrice = price;
      return this.recalculateAllTiers(clone);
    });
  }

  updateVideoDeltaPrice(val: string) {
    const price = parseFloat(val) || 0;
    this.videoDeltaPrice.set(price);
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      clone.videoDeltaPrice = price;
      return this.recalculateAllTiers(clone);
    });
  }

  updateMaxInPersonAttendees(val: string) {
    const parsed = parseInt(val, 10);
    const maxInPersonAttendees = isNaN(parsed) || parsed < 0 ? undefined : parsed;
    this.productModel.update((m) => ({ ...m, maxInPersonAttendees }));
  }

  private detectHasSpecialPrice(product: Product, role: AttendeeRole): boolean {
    if (product.hasMemberPrice !== undefined && role === AttendeeRole.Member) {
      return product.hasMemberPrice;
    }
    if (product.hasInstructorPrice !== undefined && role === AttendeeRole.Instructor) {
      return product.hasInstructorPrice;
    }
    for (const r of this.attendanceRows) {
      const includeVideo = r.attendance === AttendanceType.VideoOnly;
      const tierType = product.hasEarlyBird ? PricingTierType.EarlyBird : PricingTierType.Standard;
      const stdKey = getPricingTierKey(AttendeeRole.NonMember, r.attendance, includeVideo, tierType);
      const roleKey = getPricingTierKey(role, r.attendance, includeVideo, tierType);
      const stdTier = product.tiers[stdKey];
      const roleTier = product.tiers[roleKey];
      if (roleTier && stdTier && roleTier.price !== stdTier.price) {
        return true;
      }
    }
    return false;
  }

  addMemberPrice() {
    const model = structuredClone(this.productModel());
    const baseRole = this.standardRole();
    for (const r of this.attendanceRows) {
      const stdPrice = this.getBasePrice(baseRole, r.attendance);
      const memKey = model.hasEarlyBird
        ? getPricingTierKey(AttendeeRole.Member, r.attendance, r.attendance === AttendanceType.VideoOnly, PricingTierType.EarlyBird)
        : getPricingTierKey(AttendeeRole.Member, r.attendance, r.attendance === AttendanceType.VideoOnly, PricingTierType.Standard);
      model.tiers[memKey] = { enabled: true, price: stdPrice };
    }
    this.productModel.set(this.recalculateAllTiers(model));
    this.hasMemberPrice.set(true);
  }

  removeMemberPrice() {
    this.hasMemberPrice.set(false);
  }

  addInstructorPrice() {
    const model = structuredClone(this.productModel());
    const baseRole: AttendeeRole = (this.hasMemberPrice() && this.registrationAudience() === 'anyone') ? AttendeeRole.Member : this.standardRole();
    for (const r of this.attendanceRows) {
      const basePrice = this.getBasePrice(baseRole, r.attendance);
      const instKey = model.hasEarlyBird
        ? getPricingTierKey(AttendeeRole.Instructor, r.attendance, r.attendance === AttendanceType.VideoOnly, PricingTierType.EarlyBird)
        : getPricingTierKey(AttendeeRole.Instructor, r.attendance, r.attendance === AttendanceType.VideoOnly, PricingTierType.Standard);
      model.tiers[instKey] = { enabled: true, price: basePrice };
    }
    this.productModel.set(this.recalculateAllTiers(model));
    this.hasInstructorPrice.set(true);
  }

  removeInstructorPrice() {
    this.hasInstructorPrice.set(false);
  }

  onMarkdownChange(md: string) {
    this.productModel.update((model) => ({
      ...model,
      descriptionMarkdown: md,
    }));
  }

  getBasePrice(role: AttendeeRole, attendance: AttendanceType): number {
    const p = this.productModel();
    const includeVideo = attendance === AttendanceType.VideoOnly;
    const tierType = p.hasEarlyBird ? PricingTierType.EarlyBird : PricingTierType.Standard;
    const key = getPricingTierKey(role, attendance, includeVideo, tierType);
    return p.tiers[key]?.price ?? 0;
  }

  setBasePrice(role: AttendeeRole, attendance: AttendanceType, priceStr: string) {
    const price = parseFloat(priceStr) || 0;
    this.productModel.update((model) => {
      const clone = structuredClone(model);
      const includeVideo = attendance === AttendanceType.VideoOnly;
      const tierType = clone.hasEarlyBird ? PricingTierType.EarlyBird : PricingTierType.Standard;
      const key = getPricingTierKey(role, attendance, includeVideo, tierType);
      clone.tiers[key] = { enabled: true, price };

      if (!this.hasMemberPrice() && role === this.standardRole()) {
        const memKey = getPricingTierKey(AttendeeRole.Member, attendance, includeVideo, tierType);
        clone.tiers[memKey] = { enabled: true, price };
      }
      if (!this.hasInstructorPrice()) {
        const instKey = getPricingTierKey(AttendeeRole.Instructor, attendance, includeVideo, tierType);
        clone.tiers[instKey] = { enabled: true, price };
      }

      return this.recalculateAllTiers(clone);
    });
  }

  getTier(role: AttendeeRole, attendance: AttendanceType, includeVideo: boolean, tierType: PricingTierType = PricingTierType.Standard) {
    const key = getPricingTierKey(role, attendance, includeVideo, tierType);
    const tiers = this.productModel().tiers;
    if (!tiers[key]) {
      tiers[key] = { enabled: true, price: 0 };
    }
    return tiers[key];
  }

  setTierEnabled(role: AttendeeRole, attendance: AttendanceType, includeVideo: boolean, enabled: boolean, tierType: PricingTierType = PricingTierType.Standard) {
    const key = getPricingTierKey(role, attendance, includeVideo, tierType);
    this.productModel.update((model) => {
      const clone = structuredClone(model);
      if (!clone.tiers[key]) {
        clone.tiers[key] = { enabled, price: 0 };
      } else {
        clone.tiers[key].enabled = enabled;
      }
      return clone;
    });
  }

  setTierPrice(role: AttendeeRole, attendance: AttendanceType, includeVideo: boolean, priceStr: string, tierType: PricingTierType = PricingTierType.Standard) {
    const key = getPricingTierKey(role, attendance, includeVideo, tierType);
    const price = parseFloat(priceStr) || 0;
    this.productModel.update((model) => {
      const clone = structuredClone(model);
      if (!clone.tiers[key]) {
        clone.tiers[key] = { enabled: true, price };
      } else {
        clone.tiers[key].price = price;
      }
      return clone;
    });
  }

  calculatedTiersPreview = computed(() => {
    const p = this.productModel();
    const rows: {
      category: string;
      tierLabel: string;
      attendance: string;
      hasVideo: boolean;
      stdPrice: number;
      memPrice?: number;
      instPrice?: number;
    }[] = [];

    const audience = this.registrationAudience();
    const stdRole = this.standardRole();
    const hasMem = this.hasMemberPrice() && audience === 'anyone';
    const hasInst = this.hasInstructorPrice() && audience !== 'instructors';

    const addTierRow = (category: string, tierLabel: string, attendance: AttendanceType, hasVideo: boolean, tierType: PricingTierType) => {
      const stdPrice = p.tiers[getPricingTierKey(stdRole, attendance, hasVideo, tierType)]?.price ?? 0;
      const memPrice = hasMem ? (p.tiers[getPricingTierKey(AttendeeRole.Member, attendance, hasVideo, tierType)]?.price ?? stdPrice) : undefined;
      const instPrice = hasInst ? (p.tiers[getPricingTierKey(AttendeeRole.Instructor, attendance, hasVideo, tierType)]?.price ?? (memPrice ?? stdPrice)) : undefined;
      rows.push({
        category,
        tierLabel,
        attendance: attendance === AttendanceType.InPerson ? 'In-Person' : (attendance === AttendanceType.Online ? 'Online' : 'Recording Only'),
        hasVideo,
        stdPrice,
        memPrice,
        instPrice,
      });
    };

    if (p.allowInPerson) {
      if (p.hasEarlyBird) {
        addTierRow('In-Person', 'Early-Bird', AttendanceType.InPerson, false, PricingTierType.EarlyBird);
        if (p.allowVideo) {
          addTierRow('In-Person', 'Early-Bird + Video', AttendanceType.InPerson, true, PricingTierType.EarlyBird);
        }
      }
      addTierRow('In-Person', p.hasEarlyBird ? 'Standard (Advance)' : 'Standard', AttendanceType.InPerson, false, PricingTierType.Standard);
      if (p.allowVideo) {
        addTierRow('In-Person', p.hasEarlyBird ? 'Standard + Video' : 'Standard + Video', AttendanceType.InPerson, true, PricingTierType.Standard);
      }
      if (p.allowPayInPerson) {
        addTierRow('In-Person', 'Pay at Event', AttendanceType.InPerson, false, PricingTierType.InPerson);
        if (p.allowVideo) {
          addTierRow('In-Person', 'Pay at Event + Video', AttendanceType.InPerson, true, PricingTierType.InPerson);
        }
      }
    }

    if (p.allowOnline) {
      if (p.hasEarlyBird) {
        addTierRow('Online', 'Early-Bird', AttendanceType.Online, false, PricingTierType.EarlyBird);
        if (p.allowVideo) {
          addTierRow('Online', 'Early-Bird + Video', AttendanceType.Online, true, PricingTierType.EarlyBird);
        }
      }
      addTierRow('Online', p.hasEarlyBird ? 'Standard' : 'Standard', AttendanceType.Online, false, PricingTierType.Standard);
      if (p.allowVideo) {
        addTierRow('Online', 'Standard + Video', AttendanceType.Online, true, PricingTierType.Standard);
      }
    }

    if (p.allowVideoOnly) {
      addTierRow('Video Pre-Order', 'Standard', AttendanceType.VideoOnly, true, PricingTierType.Standard);
    }

    return rows;
  });

  updateTitle(title: string) {
    this.productModel.update((m) => ({ ...m, title }));
  }

  updateCurrency(currency: string) {
    this.productModel.update((m) => ({ ...m, currency }));
  }

  updatePurchaseDetailsMarkdown(md: string) {
    this.productModel.update((m) => ({ ...m, purchaseDetailsMarkdown: md }));
  }

  updateInPersonDetailsMarkdown(md: string) {
    this.productModel.update((m) => ({ ...m, inPersonDetailsMarkdown: md }));
  }

  updateRecordedVideoId(recordedVideoId: string) {
    this.productModel.update((m) => ({ ...m, recordedVideoId }));
  }

  updateRecordedVideoUrl(recordedVideoUrl: string) {
    this.productModel.update((m) => ({ ...m, recordedVideoUrl }));
  }

  async saveProduct() {
    const model = structuredClone(this.productModel());
    if (!model.title.trim()) {
      this.errorMessage.set('Product title is required.');
      return;
    }

    model.hasMemberPrice = this.hasMemberPrice();
    model.hasInstructorPrice = this.hasInstructorPrice();
    model.allowVideoOnly = Boolean(this.productModel().allowVideoOnly);
    model.lateDeltaPrice = this.lateDeltaPrice();
    model.hasDoorDelta = this.hasDoorDelta();
    model.doorDeltaPrice = this.doorDeltaPrice();
    model.videoDeltaPrice = this.videoDeltaPrice();

    // Apply audience selection
    const audience = this.registrationAudience();
    if (audience === 'instructors') {
      model.allowNonMembers = false;
      model.allowMembers = false;
      model.allowInstructors = true;
    } else if (audience === 'members') {
      model.allowNonMembers = false;
      model.allowMembers = true;
      model.allowInstructors = true;
    } else {
      model.allowNonMembers = true;
      model.allowMembers = true;
      model.allowInstructors = true;
    }

    const finalModel = this.recalculateAllTiers(model);

    // Sync member tiers to standard if special member price is not active
    if (!this.hasMemberPrice()) {
      const baseRole = this.standardRole();
      for (const r of this.attendanceRows) {
        for (const incVid of [false, true]) {
          for (const tierType of [PricingTierType.Standard, PricingTierType.EarlyBird, PricingTierType.InPerson]) {
            const baseKey = getPricingTierKey(baseRole, r.attendance, incVid, tierType);
            const memberKey = getPricingTierKey(AttendeeRole.Member, r.attendance, incVid, tierType);
            const baseTier = finalModel.tiers[baseKey];
            if (baseTier) {
              finalModel.tiers[memberKey] = { enabled: baseTier.enabled, price: baseTier.price };
            }
          }
        }
      }
    }

    // Sync instructor tiers if special instructor price is not active
    if (!this.hasInstructorPrice()) {
      const baseRole: AttendeeRole = (this.hasMemberPrice() && audience === 'anyone') ? AttendeeRole.Member : this.standardRole();
      for (const r of this.attendanceRows) {
        for (const incVid of [false, true]) {
          for (const tierType of [PricingTierType.Standard, PricingTierType.EarlyBird, PricingTierType.InPerson]) {
            const baseKey = getPricingTierKey(baseRole, r.attendance, incVid, tierType);
            const instructorKey = getPricingTierKey(AttendeeRole.Instructor, r.attendance, incVid, tierType);
            const baseTier = finalModel.tiers[baseKey];
            if (baseTier) {
              finalModel.tiers[instructorKey] = { enabled: baseTier.enabled, price: baseTier.price };
            }
          }
        }
      }
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    try {
      const savedDocId = await this.productService.saveProduct(finalModel);
      if (this.embedded()) {
        this.productSaved.emit(savedDocId);
      } else {
        const targetUrl = model.eventDocId
          ? this.routingService.hrefForView(Views.EventRegister, { eventId: model.eventDocId })
          : this.routingService.hrefForView(Views.ManageEventRegistrations);
        this.routingService.navigateTo(targetUrl);
      }
    } catch (err: unknown) {
      console.error('Error saving registration setup:', err);
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to save registration setup.');
      this.isSaving.set(false);
    }
  }

  async deleteProduct() {
    const id = this.productModel().docId || this.effectiveProductId();
    if (!id) return;

    if (!confirm('Are you sure you want to delete this registration setup? This action cannot be undone.')) {
      return;
    }

    this.isSaving.set(true);
    try {
      await this.productService.deleteProduct(id);
      if (this.embedded()) {
        this.productSaved.emit('');
      } else {
        const targetUrl = this.routingService.hrefForView(Views.ManageEventRegistrations);
        this.routingService.navigateTo(targetUrl);
      }
    } catch (err) {
      console.error('Error deleting registration setup:', err);
      alert('Failed to delete registration setup.');
      this.isSaving.set(false);
    }
  }
}
