/* product-edit.ts
 *
 * Admin component for creating and editing Event Registration & Pricing setups.
 * Uses compositional Rule-Based Pricing (EventPricingRules) with named Event Capacities,
 * Registration Options, Person-Status Discounts, Event Add-Ons, Deposit Policies,
 * shared Delivery Resources, and hybrid local IndexedDB + cloud Firestore draft auto-save.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import {
  areProductsEquivalentForDraft,
  cloneProductSnapshot,
  CLOUD_DRAFT_IDLE_MS,
  computeProductDraftDiff,
  LOCAL_DRAFT_DEBOUNCE_MS,
  mergeLiveCountersIntoProduct,
  ProductDraftService,
  ReconciledDraftSource,
} from '../product-draft.service';
import { NetworkStateService } from '../network-state.service';
import { formatFieldSummary } from '../object-diff';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownEditor } from '../markdown-editor/markdown-editor';
import { AutocompleteComponent, DisplayFns } from '../autocomplete/autocomplete';
import { SearchableSet } from '../searchable-set';
import { normalizeEmail } from '../../../functions/src/data-model/email';
import {
  AttendanceType,
  DepositPolicyKind,
  DepositRefundPolicyKind,
  DraftSyncStatus,
  EarlyBirdPolicyKind,
  EventPricingRules,
  EventRegistration,
  EventRegistrationStatus,
  IlcEvent,
  initProduct,
  initProductDraft,
  Product,
  ProductDraft,
  productDraftIdFor,
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

export type MarkdownProductField =
  | 'descriptionMarkdown'
  | 'inPersonDetailsMarkdown'
  | 'purchaseDetailsMarkdown';

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
  host: {
    '(document:visibilitychange)': 'onDocumentVisibilityChange()',
    '(window:pagehide)': 'flushPendingLocalDraftSync()',
  },
})
export class ProductEditComponent implements OnInit {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected productDraftService = inject(ProductDraftService);
  protected networkState = inject(NetworkStateService);
  private destroyRef = inject(DestroyRef);

  protected readonly Views = Views;
  protected readonly DraftSyncStatus = DraftSyncStatus;

  userIsAdmin = computed(() => Boolean(this.firebaseState.user()?.isAdmin));
  currentUserUid = computed(() => this.firebaseState.user()?.firebaseUser.uid || '');
  currentUserEmail = computed(() =>
    normalizeEmail(this.firebaseState.user()?.firebaseUser.email),
  );
  currentUserName = computed(
    () =>
      this.firebaseState.user()?.member.name ||
      this.firebaseState.user()?.firebaseUser.displayName ||
      '',
  );

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

  // Live/baseline snapshot & editable working model
  baselineProduct = signal<Product>(initProduct());
  productModel = signal<Product>(initProduct());
  initialRecordedVideoId = signal<string>('');
  hasLiveProduct = signal<boolean>(false);

  isNew = computed(() => !this.productModel().docId && !this.hasLiveProduct());

  isLoading = signal(false);
  isSaving = signal(false);
  errorMessage = signal<string | null>(null);

  // Draft auto-save & UI confirmation signals
  draftSyncStatus = signal<DraftSyncStatus>(DraftSyncStatus.Clean);
  activeDraft = signal<ProductDraft | null>(null);
  confirmingDiscardDraft = signal<boolean>(false);
  confirmingDeleteProduct = signal<boolean>(false);
  confirmingVideoNotification = signal<boolean>(false);
  markdownStickyTopPx = signal<number>(0);

  private localSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCloudSyncWhenOnline = false;
  private restoredFromDraft = false;
  private editedMarkdownFields = new Set<MarkdownProductField>();
  private draftHeaderObserver: ResizeObserver | null = null;
  private lastKnownDraftId = '';

  @ViewChild('draftHeaderRef')
  set draftHeaderRef(el: ElementRef<HTMLElement> | undefined) {
    this.draftHeaderObserver?.disconnect();
    this.draftHeaderObserver = null;
    const native = el?.nativeElement;
    if (!native) {
      this.markdownStickyTopPx.set(0);
      return;
    }
    const updateHeight = () => {
      const rect = native.getBoundingClientRect();
      this.markdownStickyTopPx.set(Math.max(0, Math.round(rect.height)));
    };
    updateHeight();
    if (typeof ResizeObserver !== 'undefined') {
      this.draftHeaderObserver = new ResizeObserver(() => updateHeight());
      this.draftHeaderObserver.observe(native);
    }
  }

  activeDraftId = computed(() =>
    productDraftIdFor({
      eventDocId: this.productModel().eventDocId || this.effectiveEventId(),
      productDocId:
        this.productModel().docId || this.baselineProduct().docId || this.effectiveProductId(),
    }),
  );

  isDirty = computed(
    () => !areProductsEquivalentForDraft(this.productModel(), this.baselineProduct()),
  );

  hasDraftSession = computed(
    () =>
      this.isDirty() ||
      this.activeDraft() !== null ||
      this.draftSyncStatus() !== DraftSyncStatus.Clean,
  );

  isOffline = computed(() => this.networkState.isOffline());

  canSaveDraftNow = computed(() => {
    const status = this.draftSyncStatus();
    if (this.isSaving() || status === DraftSyncStatus.SavingCloud) {
      return false;
    }
    if (status === DraftSyncStatus.SavedCloud && !this.isOffline()) {
      return false;
    }
    return this.hasDraftSession();
  });

  canPublish = computed(() => {
    if (this.isSaving()) return false;
    return this.isNew() || this.hasDraftSession();
  });

  draftSavedMetaText = computed(() => {
    const draft = this.activeDraft();
    if (!draft) return '';
    const savedIso = draft.clientSavedAt || draft.lastUpdated;
    const parts: string[] = [];
    if (savedIso) {
      const date = new Date(savedIso);
      if (!Number.isNaN(date.getTime())) {
        parts.push(
          date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        );
      }
    }
    if (draft.updatedByEmail && draft.updatedByEmail !== this.currentUserEmail()) {
      parts.push(`by ${draft.updatedByName || draft.updatedByEmail}`);
    }
    return parts.join(' · ');
  });

  conflictSummary = computed(() => {
    if (this.draftSyncStatus() !== DraftSyncStatus.ConflictWithLive) {
      return '';
    }
    const diff = computeProductDraftDiff(this.baselineProduct(), this.productModel());
    return formatFieldSummary(diff.changedKeys, 'registration setup');
  });

  // Event autocomplete search
  eventsSearchableSet = new SearchableSet<'docId', IlcEvent>(
    ['title', 'location', 'start'],
    'docId',
  );
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

    const unregisterOnline = this.networkState.registerOnlineHandler(async () => {
      if (this.pendingCloudSyncWhenOnline && this.hasDraftSession()) {
        this.pendingCloudSyncWhenOnline = false;
        await this.persistCloudDraft();
      }
    });

    this.destroyRef.onDestroy(() => {
      unregisterOnline();
      this.draftHeaderObserver?.disconnect();
      this.flushPendingLocalDraftSync();
      this.clearDraftTimers();
    });
  }

  ngOnInit() {
    if (!this.embedded()) {
      window.scrollTo(0, 0);
    }
    this.loadData();
  }

  onDocumentVisibilityChange() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.flushPendingLocalDraftSync();
    }
  }

  flushPendingLocalDraftSync() {
    if (this.localSaveTimer !== null) {
      clearTimeout(this.localSaveTimer);
      this.localSaveTimer = null;
      void this.persistLocalDraft();
    }
  }

  private clearDraftTimers() {
    if (this.localSaveTimer !== null) {
      clearTimeout(this.localSaveTimer);
      this.localSaveTimer = null;
    }
    if (this.cloudSaveTimer !== null) {
      clearTimeout(this.cloudSaveTimer);
      this.cloudSaveTimer = null;
    }
  }

  async loadData() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.clearDraftTimers();
    this.editedMarkdownFields.clear();
    this.restoredFromDraft = false;
    this.confirmingDiscardDraft.set(false);
    this.confirmingDeleteProduct.set(false);
    this.confirmingVideoNotification.set(false);

    try {
      // 1. Initialize searchable events
      const eventsSnap = await this.dataService.getEvents();
      if (eventsSnap.length > 0) {
        this.eventsSearchableSet.setEntries(eventsSnap);
      }

      // 2. Load live product if editing or event route
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

      let baseProduct: Product;
      if (existing) {
        baseProduct = cloneProductSnapshot(existing);
        this.hasLiveProduct.set(true);
        this.initialRecordedVideoId.set(existing.recordedVideoId);
      } else {
        this.hasLiveProduct.set(false);
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
        baseProduct = syncProductSummaryFlagsFromRules(newProduct);
        this.initialRecordedVideoId.set(newProduct.recordedVideoId);
      }

      // 3. Reconcile any saved local IndexedDB or cloud /product_drafts draft
      const draftId = productDraftIdFor({
        eventDocId: baseProduct.eventDocId || evId,
        productDocId: baseProduct.docId || id,
      });
      this.lastKnownDraftId = draftId;

      if (this.userIsAdmin()) {
        const reconciled = await this.productDraftService.reconcileDraft({
          draftId,
          liveProduct: existing ?? null,
          uid: this.currentUserUid(),
        });

        this.baselineProduct.set(cloneProductSnapshot(baseProduct));
        if (reconciled.draft) {
          this.restoredFromDraft = true;
          this.activeDraft.set(reconciled.draft);
          this.productModel.set(cloneProductSnapshot(reconciled.draft.draftProduct));

          if (reconciled.hasConflictWithLive) {
            this.draftSyncStatus.set(DraftSyncStatus.ConflictWithLive);
          } else if (reconciled.source === ReconciledDraftSource.Local) {
            this.draftSyncStatus.set(DraftSyncStatus.SavedLocal);
            if (reconciled.needsCloudSync) {
              this.scheduleCloudIdleSync();
            }
          } else {
            this.draftSyncStatus.set(DraftSyncStatus.SavedCloud);
          }
        } else {
          this.activeDraft.set(null);
          this.productModel.set(cloneProductSnapshot(baseProduct));
          this.draftSyncStatus.set(DraftSyncStatus.Clean);
        }
      } else {
        this.baselineProduct.set(cloneProductSnapshot(baseProduct));
        this.activeDraft.set(null);
        this.productModel.set(cloneProductSnapshot(baseProduct));
        this.draftSyncStatus.set(DraftSyncStatus.Clean);
      }

      // 4. Load registrations to calculate video access impact
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

  // Aligns baselineProduct (and untouched productModel) with Milkdown's initial canonicalization
  // so mounting an existing registration setup never creates a false-positive dirty draft.
  onMarkdownFieldInitialized(field: MarkdownProductField, canonicalMd: string) {
    if (this.editedMarkdownFields.has(field)) {
      return;
    }
    if (!this.restoredFromDraft) {
      this.baselineProduct.update((base) => ({
        ...base,
        [field]: canonicalMd,
      }));
      this.productModel.update((model) => ({
        ...model,
        [field]: canonicalMd,
      }));
    } else {
      this.productModel.update((model) => ({
        ...model,
        [field]: canonicalMd,
      }));
    }
  }

  private recordUserEdit(updater: (model: Product) => Product) {
    if (this.errorMessage()) {
      this.errorMessage.set(null);
    }
    if (this.confirmingVideoNotification()) {
      this.confirmingVideoNotification.set(false);
    }
    if (this.confirmingDiscardDraft()) {
      this.confirmingDiscardDraft.set(false);
    }
    this.productModel.update(updater);
    this.scheduleDraftSaves();
  }

  private scheduleDraftSaves() {
    if (!this.userIsAdmin()) return;

    // If user reverted all edits back to exact baseline and no conflict exists, clean up draft.
    if (!this.isDirty() && this.draftSyncStatus() !== DraftSyncStatus.ConflictWithLive) {
      this.clearDraftTimers();
      this.pendingCloudSyncWhenOnline = false;
      const existingDraft = this.activeDraft();
      if (existingDraft) {
        this.activeDraft.set(null);
        this.draftSyncStatus.set(DraftSyncStatus.Clean);
        void this.productDraftService.deleteDraftEverywhere(
          this.currentUserUid(),
          existingDraft.docId,
        );
      } else {
        this.draftSyncStatus.set(DraftSyncStatus.Clean);
      }
      return;
    }

    if (this.draftSyncStatus() !== DraftSyncStatus.ConflictWithLive) {
      this.draftSyncStatus.set(DraftSyncStatus.SavingLocal);
    }

    if (this.localSaveTimer !== null) {
      clearTimeout(this.localSaveTimer);
    }
    this.localSaveTimer = setTimeout(() => {
      this.localSaveTimer = null;
      void this.persistLocalDraft();
    }, LOCAL_DRAFT_DEBOUNCE_MS);

    if (this.draftSyncStatus() !== DraftSyncStatus.ConflictWithLive) {
      this.scheduleCloudIdleSync();
    }
  }

  private scheduleCloudIdleSync() {
    if (this.cloudSaveTimer !== null) {
      clearTimeout(this.cloudSaveTimer);
    }
    this.cloudSaveTimer = setTimeout(() => {
      this.cloudSaveTimer = null;
      void this.persistCloudDraft();
    }, CLOUD_DRAFT_IDLE_MS);
  }

  private buildDraftSnapshot(): ProductDraft {
    const model = cloneProductSnapshot(this.productModel());
    const baseline = this.baselineProduct();
    const prior = this.activeDraft();
    const eventDocId = model.eventDocId || this.effectiveEventId();
    const productDocId = model.docId || baseline.docId || this.effectiveProductId();
    const draftId = productDraftIdFor({ eventDocId, productDocId });
    const nowIso = new Date().toISOString();

    return initProductDraft({
      docId: draftId,
      eventDocId,
      productDocId,
      baseProductLastUpdated:
        prior?.baseProductLastUpdated !== undefined &&
        this.draftSyncStatus() === DraftSyncStatus.ConflictWithLive
          ? prior.baseProductLastUpdated
          : this.hasLiveProduct()
            ? baseline.lastUpdated
            : '',
      draftProduct: model,
      updatedByEmail: this.currentUserEmail(),
      updatedByName: this.currentUserName(),
      clientSavedAt: nowIso,
      createdAt: prior?.createdAt || nowIso,
      lastUpdated: prior?.lastUpdated || nowIso,
    });
  }

  async persistLocalDraft(): Promise<ProductDraft | null> {
    if (!this.userIsAdmin()) return null;
    const draft = this.buildDraftSnapshot();
    const previousDraftId = this.lastKnownDraftId;
    this.lastKnownDraftId = draft.docId;

    if (previousDraftId && previousDraftId !== draft.docId) {
      void this.productDraftService.deleteDraftEverywhere(
        this.currentUserUid(),
        previousDraftId,
      );
    }

    const saved = await this.productDraftService.saveLocalDraft(this.currentUserUid(), draft);
    this.activeDraft.set(saved);
    if (
      this.draftSyncStatus() !== DraftSyncStatus.ConflictWithLive &&
      this.draftSyncStatus() !== DraftSyncStatus.SavingCloud
    ) {
      this.draftSyncStatus.set(DraftSyncStatus.SavedLocal);
    }
    return saved;
  }

  async persistCloudDraft(): Promise<void> {
    if (!this.userIsAdmin()) return;
    if (this.localSaveTimer !== null) {
      clearTimeout(this.localSaveTimer);
      this.localSaveTimer = null;
      await this.persistLocalDraft();
    }

    const draft = this.activeDraft() ?? (await this.persistLocalDraft());
    if (!draft) return;

    if (this.isOffline()) {
      this.pendingCloudSyncWhenOnline = true;
      if (this.draftSyncStatus() !== DraftSyncStatus.ConflictWithLive) {
        this.draftSyncStatus.set(DraftSyncStatus.SavedLocal);
      }
      return;
    }

    const preserveConflict = this.draftSyncStatus() === DraftSyncStatus.ConflictWithLive;
    if (!preserveConflict) {
      this.draftSyncStatus.set(DraftSyncStatus.SavingCloud);
    }

    try {
      const savedCloud = await this.productDraftService.saveCloudDraft(draft);
      await this.productDraftService.saveLocalDraft(this.currentUserUid(), savedCloud);
      this.activeDraft.set(savedCloud);
      this.pendingCloudSyncWhenOnline = false;
      if (!preserveConflict) {
        this.draftSyncStatus.set(DraftSyncStatus.SavedCloud);
      }
    } catch (err) {
      console.warn('Error saving product draft to cloud:', err);
      if (this.isOffline()) {
        this.pendingCloudSyncWhenOnline = true;
        if (!preserveConflict) {
          this.draftSyncStatus.set(DraftSyncStatus.SavedLocal);
        }
      } else if (!preserveConflict) {
        this.draftSyncStatus.set(DraftSyncStatus.Error);
      }
    }
  }

  // Explicitly flushes the current work-in-progress draft to IndexedDB + Firestore immediately
  // without running publish-time pricing rule validation.
  async saveDraftNow() {
    if (!this.userIsAdmin()) return;
    this.clearDraftTimers();
    await this.persistLocalDraft();
    await this.persistCloudDraft();
  }

  requestDiscardDraft() {
    this.confirmingDeleteProduct.set(false);
    this.confirmingVideoNotification.set(false);
    this.confirmingDiscardDraft.set(true);
  }

  cancelDiscardDraft() {
    this.confirmingDiscardDraft.set(false);
  }

  async confirmDiscardDraft() {
    this.clearDraftTimers();
    this.pendingCloudSyncWhenOnline = false;
    const draftId = this.activeDraft()?.docId || this.activeDraftId();
    this.confirmingDiscardDraft.set(false);
    this.errorMessage.set(null);
    this.restoredFromDraft = false;
    this.editedMarkdownFields.clear();
    this.productModel.set(cloneProductSnapshot(this.baselineProduct()));
    this.activeDraft.set(null);
    this.draftSyncStatus.set(DraftSyncStatus.Clean);
    await this.productDraftService.deleteDraftEverywhere(this.currentUserUid(), draftId);
  }

  // Resolves ConflictWithLive by rebasing the draft onto the latest live product's timestamp
  // while preserving live attendee capacityCounts.
  async keepDraftOverLiveConflict() {
    const live = this.baselineProduct();
    const mergedModel = mergeLiveCountersIntoProduct(
      this.productModel(),
      this.hasLiveProduct() ? live : null,
    );
    this.productModel.set(mergedModel);
    const rebasedDraft = initProductDraft({
      ...(this.activeDraft() ?? {}),
      docId: this.activeDraftId(),
      eventDocId: mergedModel.eventDocId || this.effectiveEventId(),
      productDocId: mergedModel.docId || live.docId,
      baseProductLastUpdated: this.hasLiveProduct() ? live.lastUpdated : '',
      draftProduct: mergedModel,
      updatedByEmail: this.currentUserEmail(),
      updatedByName: this.currentUserName(),
      clientSavedAt: new Date().toISOString(),
    });
    this.activeDraft.set(rebasedDraft);
    this.draftSyncStatus.set(DraftSyncStatus.SavedLocal);
    await this.productDraftService.saveLocalDraft(this.currentUserUid(), rebasedDraft);
    await this.persistCloudDraft();
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
    this.recordUserEdit((m) => ({
      ...m,
      eventDocId: event.docId,
      title: m.title.trim() ? m.title : event.title,
    }));
    this.loadRegistrationsForEvent(event.docId);
  }

  clearLinkedEvent() {
    this.recordUserEdit((m) => ({
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
    this.editedMarkdownFields.add('descriptionMarkdown');
    this.recordUserEdit((model) => ({
      ...model,
      descriptionMarkdown: md,
    }));
  }

  updateTitle(title: string) {
    this.recordUserEdit((m) => ({ ...m, title }));
  }

  updateCurrency(currency: string) {
    this.recordUserEdit((m) => ({ ...m, currency }));
  }

  updatePurchaseDetailsMarkdown(md: string) {
    this.editedMarkdownFields.add('purchaseDetailsMarkdown');
    this.recordUserEdit((m) => ({ ...m, purchaseDetailsMarkdown: md }));
  }

  updateInPersonDetailsMarkdown(md: string) {
    this.editedMarkdownFields.add('inPersonDetailsMarkdown');
    this.recordUserEdit((m) => ({ ...m, inPersonDetailsMarkdown: md }));
  }

  updateRecordedVideoId(recordedVideoId: string) {
    this.recordUserEdit((m) => ({ ...m, recordedVideoId }));
  }

  updateRecordedVideoUrl(recordedVideoUrl: string) {
    this.recordUserEdit((m) => ({ ...m, recordedVideoUrl }));
  }

  onPricingRulesChange(pricingRules: EventPricingRules) {
    this.recordUserEdit((m) =>
      syncProductSummaryFlagsFromRules({
        ...m,
        pricingRules,
      }),
    );
  }

  dismissError() {
    this.errorMessage.set(null);
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

  async saveProduct(videoNotificationConfirmed = false) {
    const model = cloneProductSnapshot(this.productModel());
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

    if (isVideoAddedOrChanged && recipientsCount > 0 && !videoNotificationConfirmed) {
      this.confirmingDiscardDraft.set(false);
      this.confirmingDeleteProduct.set(false);
      this.confirmingVideoNotification.set(true);
      return;
    }

    this.confirmingVideoNotification.set(false);
    this.isSaving.set(true);
    this.errorMessage.set(null);

    try {
      // Preserve live capacityCounts and inPersonRegistrationsCount from Firestore so publishing
      // a multi-day draft never overwrites attendee registrations recorded in the meantime.
      let publishPayload = finalModel;
      if (finalModel.docId) {
        const latestLive =
          (await this.productService.getProduct(finalModel.docId)) ??
          (this.hasLiveProduct() ? this.baselineProduct() : undefined);
        publishPayload = mergeLiveCountersIntoProduct(finalModel, latestLive);
      }

      const draftIdBeforeSave = this.activeDraft()?.docId || this.activeDraftId();
      const savedDocId = await this.dataService.saveProduct(publishPayload);
      this.clearDraftTimers();
      this.pendingCloudSyncWhenOnline = false;

      const publishedSnapshot: Product = {
        ...publishPayload,
        docId: savedDocId,
      };
      this.hasLiveProduct.set(true);
      this.baselineProduct.set(cloneProductSnapshot(publishedSnapshot));
      this.productModel.set(cloneProductSnapshot(publishedSnapshot));
      this.initialRecordedVideoId.set(publishedSnapshot.recordedVideoId);
      this.activeDraft.set(null);
      this.draftSyncStatus.set(DraftSyncStatus.Clean);

      const postPublishDraftId = productDraftIdFor({
        eventDocId: publishedSnapshot.eventDocId || this.effectiveEventId(),
        productDocId: savedDocId,
      });
      await this.productDraftService.deleteDraftEverywhere(
        this.currentUserUid(),
        draftIdBeforeSave,
      );
      if (postPublishDraftId !== draftIdBeforeSave) {
        await this.productDraftService.deleteDraftEverywhere(
          this.currentUserUid(),
          postPublishDraftId,
        );
      }

      if (this.embedded()) {
        this.isSaving.set(false);
        this.productSaved.emit(savedDocId);
      } else {
        const targetUrl =
          !this.isFromRegistrationsList() && publishedSnapshot.eventDocId
            ? this.routingService.hrefForView(Views.ManageEventView, {
                eventId: publishedSnapshot.eventDocId,
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

  cancelVideoNotificationConfirm() {
    this.confirmingVideoNotification.set(false);
  }

  requestDeleteProduct() {
    const id = this.productModel().docId || this.effectiveProductId();
    if (!id) return;
    this.confirmingDiscardDraft.set(false);
    this.confirmingVideoNotification.set(false);
    this.confirmingDeleteProduct.set(true);
  }

  cancelDeleteProduct() {
    this.confirmingDeleteProduct.set(false);
  }

  async confirmDeleteProduct() {
    const id = this.productModel().docId || this.effectiveProductId();
    if (!id) return;

    const eventDocId = this.productModel().eventDocId || this.effectiveEventId();
    const draftId = this.activeDraft()?.docId || this.activeDraftId();
    this.confirmingDeleteProduct.set(false);
    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.clearDraftTimers();
    this.pendingCloudSyncWhenOnline = false;

    try {
      await this.dataService.deleteProduct(id);
      await this.productDraftService.deleteDraftEverywhere(this.currentUserUid(), draftId);
      this.activeDraft.set(null);
      this.draftSyncStatus.set(DraftSyncStatus.Clean);

      if (this.embedded()) {
        this.isSaving.set(false);
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
