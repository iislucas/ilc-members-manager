/* product-edit.ts
 *
 * Admin component for creating and editing Event Registration & Pricing setups.
 * Uses compositional Rule-Based Pricing (EventPricingRules) with named Event Capacities,
 * Registration Options, Person-Status Discounts, Event Add-Ons, Deposit Policies,
 * and shared Delivery Resources (in-person notes, online links, and VOD recordings).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { SearchableSet } from '../searchable-set';
import {
  AttendanceType,
  DepositPolicyKind,
  DepositRefundPolicyKind,
  EarlyBirdPolicyKind,
  EventPricingRules,
  EventRegistration,
  EventRegistrationStatus,
  IlcEvent,
  initProduct,
  Product,
  RegistrationQuestionKind,
  syncProductSummaryFlagsFromRules,
  validateRuleConditions,
} from '../../../functions/src/data-model/events';
import { VodPreviewComponent } from '../vod-preview/vod-preview';
import { ProductRulesEditComponent } from '../product-rules-edit/product-rules-edit';

export interface VodOptionItem {
  id: string;
  type: 'series' | 'video';
  title: string;
  seriesTitle?: string;
  displayName: string;
}

@Component({
  selector: 'app-product-edit',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    SpinnerComponent,
    MarkdownEditor,
    AutocompleteComponent,
    VodPreviewComponent,
    ProductRulesEditComponent,
  ],
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

  userIsAdmin = computed(() => Boolean(this.firebaseState.user()?.isAdmin));

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
  titleLoaded = output<string>();

  isFromRegistrationsList = computed(
    () => this.routingService.matchedPatternId() === Views.ManageEventRegistrationsEdit,
  );

  // Route pathVars signal across the two registration setup routes.
  private routeEventId = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.ManageEventRegistrationsEdit) {
      return this.routingService.signals[Views.ManageEventRegistrationsEdit].pathVars.eventId();
    }
    if (match === Views.ManageEventRegistration) {
      return this.routingService.signals[Views.ManageEventRegistration].pathVars.eventId();
    }
    return '';
  });

  effectiveEventId = computed(() => {
    return this.embeddedEventDocId() || this.routeEventId();
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
  initialRecordedVideoId = signal<string>('');

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

  // VOD autocomplete search
  vodOptionsSet = new SearchableSet<'id', VodOptionItem>(
    ['title', 'seriesTitle', 'id', 'displayName'],
    'id',
  );
  vodDisplayFns: DisplayFns<VodOptionItem> = {
    toChipId: (v: VodOptionItem) => v.id,
    toName: (v: VodOptionItem) => v.displayName,
  };

  // Event registrations & video access impact
  eventRegistrations = signal<EventRegistration[]>([]);

  attendeesWithVideoAccess = computed(() => {
    return this.eventRegistrations().filter(
      (r) => r.hasVideoAccess && r.status !== EventRegistrationStatus.Cancelled,
    );
  });

  videoOnlyAttendeesCount = computed(() => {
    return this.attendeesWithVideoAccess().filter(
      (r) => r.attendance === AttendanceType.VideoOnly,
    ).length;
  });

  includedVideoAttendeesCount = computed(() => {
    return this.attendeesWithVideoAccess().filter(
      (r) => r.attendance !== AttendanceType.VideoOnly,
    ).length;
  });

  currencySymbol = computed(() => {
    switch (this.productModel().currency.toLowerCase()) {
      case 'eur':
        return '€';
      case 'gbp':
        return '£';
      default:
        return '$';
    }
  });

  constructor() {
    effect(() => {
      const allVideos = this.dataService.videos.entries();
      const seriesList = this.dataService.getVideoSeriesList();

      const items: VodOptionItem[] = [];
      const seenIds = new Set<string>();

      // 1. Series options
      for (const s of seriesList) {
        if (!s.seriesId || seenIds.has(s.seriesId)) continue;
        seenIds.add(s.seriesId);
        const count = s.videoCount || s.videos?.length || 1;
        items.push({
          id: s.seriesId,
          type: 'series',
          title: s.title || s.seriesId,
          seriesTitle: s.title,
          displayName: `[Series (${count} part${count === 1 ? '' : 's'})] ${s.title || s.seriesId} (${s.seriesId})`,
        });
      }

      // 2. Individual videos
      for (const v of allVideos) {
        if (!v.docId || seenIds.has(v.docId)) continue;
        seenIds.add(v.docId);
        const prefix = v.seriesId ? `[Episode] ` : `[Video] `;
        items.push({
          id: v.docId,
          type: 'video',
          title: v.title || v.docId,
          seriesTitle: v.seriesTitle,
          displayName: `${prefix}${v.title || v.docId} (${v.docId})`,
        });
      }

      this.vodOptionsSet.setEntries(items);
    });
  }

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
      if (eventsSnap.length > 0) {
        this.eventsSearchableSet.setEntries(eventsSnap);
      }

      // 2. Load product if editing or event route
      const id = this.effectiveProductId();
      const evId = this.effectiveEventId();

      let existing: Product | undefined;
      let loadedEv: IlcEvent | undefined;
      if (id) {
        existing = await this.productService.getProduct(id);
      } else if (evId) {
        loadedEv = await this.dataService.getEventById(evId);
        if (loadedEv?.productId) {
          existing = await this.productService.getProduct(loadedEv.productId);
        } else {
          existing = await this.productService.getProductByEventId(evId);
        }
      }

      const resolvedEvent =
        loadedEv ||
        (evId ? this.eventsSearchableSet.get(evId) : undefined) ||
        (existing?.eventDocId ? this.eventsSearchableSet.get(existing.eventDocId) : undefined);
      if (resolvedEvent?.title) {
        this.titleLoaded.emit(resolvedEvent.title);
      }

      if (existing) {
        this.productModel.set(syncProductSummaryFlagsFromRules(structuredClone(existing)));
        this.initialRecordedVideoId.set(existing.recordedVideoId);
      } else {
        const newProduct = initProduct();
        if (evId) {
          newProduct.eventDocId = evId;
          if (resolvedEvent) {
            if (!this.embeddedEventTitle()) {
              newProduct.title = resolvedEvent.title;
            }
            if (resolvedEvent.purchaseDetailsMarkdown) {
              newProduct.purchaseDetailsMarkdown = resolvedEvent.purchaseDetailsMarkdown;
            } else if (resolvedEvent.onlineJoiningLink) {
              newProduct.purchaseDetailsMarkdown = resolvedEvent.onlineJoiningLink;
            }
            if (resolvedEvent.inPersonDetailsMarkdown) {
              newProduct.inPersonDetailsMarkdown = resolvedEvent.inPersonDetailsMarkdown;
            }
            if (resolvedEvent.recordedVideoId) {
              newProduct.recordedVideoId = resolvedEvent.recordedVideoId;
            }
            if (resolvedEvent.recordedVideoUrl) {
              newProduct.recordedVideoUrl = resolvedEvent.recordedVideoUrl;
            }
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
        this.productModel.set(syncProductSummaryFlagsFromRules(newProduct));
        this.initialRecordedVideoId.set(newProduct.recordedVideoId);
      }

      // Load registrations to calculate video access impact
      const eventIdToLoad = this.productModel().eventDocId || evId;
      if (eventIdToLoad) {
        await this.loadRegistrationsForEvent(eventIdToLoad);
      }
    } catch (err) {
      console.error('Error loading product data:', err);
      this.errorMessage.set('Failed to load data.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadRegistrationsForEvent(eventId: string) {
    if (!eventId) {
      this.eventRegistrations.set([]);
      return;
    }
    try {
      const regs = await this.productService.getEventRegistrations(eventId);
      this.eventRegistrations.set(regs);
    } catch (err) {
      console.error('Error loading registrations for event:', err);
      this.eventRegistrations.set([]);
    }
  }

  onEventSelected(event: IlcEvent | null) {
    if (!event) return;
    this.productModel.update((m) => ({
      ...m,
      eventDocId: event.docId,
      title: m.title.trim() ? m.title : event.title,
    }));
    this.loadRegistrationsForEvent(event.docId);
  }

  clearLinkedEvent() {
    this.productModel.update((m) => ({
      ...m,
      eventDocId: '',
    }));
    this.eventRegistrations.set([]);
  }

  onVodOptionSelected(item: VodOptionItem | null) {
    if (!item) return;
    this.updateRecordedVideoId(item.id);
  }

  onMarkdownChange(md: string) {
    this.productModel.update((model) => ({
      ...model,
      descriptionMarkdown: md,
    }));
  }

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

  onPricingRulesChange(pricingRules: EventPricingRules) {
    this.productModel.update((m) =>
      syncProductSummaryFlagsFromRules({
        ...m,
        pricingRules,
      }),
    );
  }

  private validatePricingRules(rules: EventPricingRules): string | null {
    if (rules.registrationOptions.length === 0) {
      return 'At least one Registration Option is required.';
    }
    for (const cap of rules.capacities) {
      if (!cap.label.trim()) {
        return 'Every Capacity Limit must have a name.';
      }
      if (!Number.isFinite(cap.limit) || cap.limit < 1) {
        return `Capacity limit "${cap.label}" must be at least 1.`;
      }
    }
    if (
      rules.earlyBird.kind === EarlyBirdPolicyKind.Enabled &&
      !rules.earlyBird.deadlineDate.trim()
    ) {
      return 'Early Bird cutoff date is required when Early Bird Pricing is enabled.';
    }
    const earlyBirdEnabled =
      rules.earlyBird.kind === EarlyBirdPolicyKind.Enabled &&
      Boolean(rules.earlyBird.deadlineDate.trim());
    const validOptionIds = new Set(rules.registrationOptions.map((o) => o.id));

    for (const opt of rules.registrationOptions) {
      if (!opt.label.trim()) {
        return 'Every Registration Option must have a label.';
      }
      const condErrors = validateRuleConditions(opt.conditions, {
        itemLabel: opt.label.trim(),
        allowRegistrationCondition: false,
        earlyBirdEnabled,
        validOptionIds,
      });
      if (condErrors.length > 0) return condErrors[0];
    }
    for (const disc of rules.discounts) {
      if (!disc.label.trim()) {
        return 'Every Discount must have a label.';
      }
      const condErrors = validateRuleConditions(disc.conditions, {
        itemLabel: disc.label.trim(),
        allowRegistrationCondition: true,
        earlyBirdEnabled,
        validOptionIds,
      });
      if (condErrors.length > 0) return condErrors[0];
    }
    for (const addOn of rules.addOns) {
      if (!addOn.label.trim()) {
        return 'Every Event Add-On must have a label.';
      }
      const condErrors = validateRuleConditions(addOn.conditions, {
        itemLabel: addOn.label.trim(),
        allowRegistrationCondition: true,
        allowPaymentCondition: true,
        earlyBirdEnabled,
        validOptionIds,
      });
      if (condErrors.length > 0) return condErrors[0];
    }
    for (const q of rules.questions) {
      if (!q.label.trim()) {
        return 'Every Registration Form Question must have a prompt.';
      }
      if (
        (q.spec.kind === RegistrationQuestionKind.Select ||
          q.spec.kind === RegistrationQuestionKind.Checkboxes) &&
        q.spec.options.length === 0
      ) {
        return `Form question "${q.label.trim()}" must have at least one choice.`;
      }
      const condErrors = validateRuleConditions(q.conditions, {
        itemLabel: q.label.trim(),
        allowRegistrationCondition: true,
        earlyBirdEnabled,
        validOptionIds,
      });
      if (condErrors.length > 0) return condErrors[0];
    }
    const hasAnyPayment =
      rules.payment.allowFullPayment ||
      rules.payment.depositPolicy.kind === DepositPolicyKind.Enabled ||
      rules.payment.allowZeroDepositInPerson;
    if (!hasAnyPayment) {
      return 'Enable at least one payment method (Full Payment, Deposit, or Pay at Door).';
    }
    if (
      rules.payment.depositPolicy.kind === DepositPolicyKind.Enabled &&
      rules.payment.depositPolicy.refundPolicy.kind === DepositRefundPolicyKind.RefundableBefore &&
      !rules.payment.depositPolicy.refundPolicy.deadlineDate.trim()
    ) {
      return 'Deposit refund deadline date is required when deposit is refundable before a date.';
    }
    return null;
  }

  async saveProduct() {
    const model = structuredClone(this.productModel());
    if (!model.title.trim()) {
      this.errorMessage.set('Product title is required.');
      return;
    }

    const rulesError = this.validatePricingRules(model.pricingRules);
    if (rulesError) {
      this.errorMessage.set(rulesError);
      return;
    }

    const finalModel = syncProductSummaryFlagsFromRules(model);

    const currentVideoId = finalModel.recordedVideoId.trim();
    const previousVideoId = this.initialRecordedVideoId().trim();
    const isVideoAddedOrChanged = Boolean(currentVideoId) && currentVideoId !== previousVideoId;
    const recipientsCount = this.attendeesWithVideoAccess().length;

    if (isVideoAddedOrChanged && recipientsCount > 0) {
      const videoOnly = this.videoOnlyAttendeesCount();
      const included = this.includedVideoAttendeesCount();
      const confirmed = window.confirm(
        `You are setting or changing the video recording for this event.\n\n` +
          `This will automatically grant video access and send release notification emails to ${recipientsCount} attendee(s):\n` +
          `• ${videoOnly} video-only pre-order attendee(s)\n` +
          `• ${included} attendee(s) with video included in registration\n\n` +
          `Are you sure you want to proceed?`,
      );
      if (!confirmed) {
        return;
      }
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    try {
      const savedDocId = await this.dataService.saveProduct(finalModel);
      this.initialRecordedVideoId.set(finalModel.recordedVideoId);
      if (this.embedded()) {
        this.productSaved.emit(savedDocId);
      } else {
        const targetUrl =
          !this.isFromRegistrationsList() && finalModel.eventDocId
            ? this.routingService.hrefForView(Views.ManageEventView, {
                eventId: finalModel.eventDocId,
              })
            : this.routingService.hrefForView(Views.ManageEventRegistrations);
        this.routingService.navigateTo(targetUrl);
      }
    } catch (err: unknown) {
      console.error('Error saving registration setup:', err);
      this.errorMessage.set(
        err instanceof Error ? err.message : 'Failed to save registration setup.',
      );
      this.isSaving.set(false);
    }
  }

  async deleteProduct() {
    const id = this.productModel().docId || this.effectiveProductId();
    if (!id) return;

    if (
      !window.confirm(
        'Are you sure you want to delete this registration setup? This action cannot be undone.',
      )
    ) {
      return;
    }

    const eventDocId = this.productModel().eventDocId || this.effectiveEventId();
    this.isSaving.set(true);
    this.errorMessage.set(null);
    try {
      await this.dataService.deleteProduct(id);
      if (this.embedded()) {
        this.productSaved.emit('');
      } else {
        const targetUrl =
          !this.isFromRegistrationsList() && eventDocId
            ? this.routingService.hrefForView(Views.ManageEventView, { eventId: eventDocId })
            : this.routingService.hrefForView(Views.ManageEventRegistrations);
        this.routingService.navigateTo(targetUrl);
      }
    } catch (err) {
      console.error('Error deleting registration setup:', err);
      this.errorMessage.set('Failed to delete registration setup.');
      this.isSaving.set(false);
    }
  }
}
