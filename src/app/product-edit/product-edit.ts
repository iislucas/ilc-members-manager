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
import {
  AttendeeRole,
  AttendanceType,
  getPricingTierKey,
  IlcEvent,
  initProduct,
  Product,
} from '../../../functions/src/data-model';

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

  productIdInput = input<string>('', { alias: 'productId' });
  embedded = input<boolean>(false);
  embeddedEventDocId = input<string>('');
  embeddedEventTitle = input<string>('');
  embeddedOnlineJoiningLink = input<string>('');
  embeddedRecordedVideoId = input<string>('');
  embeddedRecordedVideoUrl = input<string>('');

  productSaved = output<string>();
  editCancelled = output<void>();

  // Route pathVars signal
  private routeProductId = this.routingService.signals[Views.ManageProductEdit]?.pathVars?.productId;

  effectiveProductId = computed(() => {
    return this.productIdInput() || (this.routeProductId ? this.routeProductId() : '');
  });

  isNew = computed(() => !this.effectiveProductId());

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
    if (a === 'instructors') return 'instructor';
    if (a === 'members') return 'member';
    return 'non_member';
  });

  standardRoleLabel = computed<string>(() => {
    const a = this.registrationAudience();
    if (a === 'instructors') return 'Instructor Price';
    if (a === 'members') return 'Member Price';
    return 'Standard Price';
  });

  // Attendance options (rows of the matrix)
  attendanceRows: {
    attendance: AttendanceType;
    includeVideo: boolean;
    getLabel: (p: Product) => string;
    isAllowed: (p: Product) => boolean;
  }[] = [
    {
      attendance: 'in_person',
      includeVideo: false,
      getLabel: (p) => (p.allowVideo ? 'In-Person (No Video)' : 'In-Person Attendance'),
      isAllowed: (p) => p.allowInPerson,
    },
    {
      attendance: 'in_person',
      includeVideo: true,
      getLabel: () => 'In-Person (+ Video)',
      isAllowed: (p) => p.allowInPerson && p.allowVideo,
    },
    {
      attendance: 'online',
      includeVideo: false,
      getLabel: (p) => (p.allowVideo ? 'Online (No Video)' : 'Online Attendance'),
      isAllowed: (p) => p.allowOnline,
    },
    {
      attendance: 'online',
      includeVideo: true,
      getLabel: () => 'Online (+ Video)',
      isAllowed: (p) => p.allowOnline && p.allowVideo,
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
      // 1. Load available events
      const eventsSnap = await this.dataService.getEvents();
      if (eventsSnap && eventsSnap.length > 0) {
        this.eventsSearchableSet.setEntries(eventsSnap);
      }

      // 2. Load product if editing
      const id = this.effectiveProductId();
      if (id) {
        const existing = await this.productService.getProduct(id);
        if (existing) {
          this.productModel.set(structuredClone(existing));
          this.hasMemberPrice.set(Boolean(existing.hasMemberPrice ?? this.detectHasSpecialPrice(existing, 'member')));
          this.hasInstructorPrice.set(Boolean(existing.hasInstructorPrice ?? this.detectHasSpecialPrice(existing, 'instructor')));
        } else {
          this.errorMessage.set('Product not found.');
        }
      } else {
        const newProduct = initProduct();
        if (this.embeddedEventDocId()) {
          newProduct.eventDocId = this.embeddedEventDocId();
        }
        if (this.embeddedEventTitle()) {
          newProduct.title = this.embeddedEventTitle();
        }
        if (this.embeddedOnlineJoiningLink()) {
          newProduct.onlineJoiningLink = this.embeddedOnlineJoiningLink();
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

  toggleAttendanceMode(mode: 'in_person' | 'online' | 'video') {
    this.productModel.update((m) => {
      const clone = structuredClone(m);
      if (mode === 'in_person') clone.allowInPerson = !clone.allowInPerson;
      if (mode === 'online') clone.allowOnline = !clone.allowOnline;
      if (mode === 'video') clone.allowVideo = !clone.allowVideo;
      clone.allowVideoOnly = false;

      // Ensure tiers for all active rows exist and have enabled: true
      for (const r of this.attendanceRows) {
        if (r.isAllowed(clone)) {
          for (const role of ['non_member', 'member', 'instructor'] as AttendeeRole[]) {
            const key = getPricingTierKey(role, r.attendance, r.includeVideo);
            if (!clone.tiers[key]) {
              clone.tiers[key] = { enabled: true, price: 0 };
            } else {
              clone.tiers[key].enabled = true;
            }
          }
        }
      }
      return clone;
    });
  }

  private detectHasSpecialPrice(product: Product, role: AttendeeRole): boolean {
    if (product.hasMemberPrice !== undefined && role === 'member') {
      return product.hasMemberPrice;
    }
    if (product.hasInstructorPrice !== undefined && role === 'instructor') {
      return product.hasInstructorPrice;
    }
    for (const r of this.attendanceRows) {
      const stdKey = getPricingTierKey('non_member', r.attendance, r.includeVideo);
      const roleKey = getPricingTierKey(role, r.attendance, r.includeVideo);
      const stdTier = product.tiers[stdKey];
      const roleTier = product.tiers[roleKey];
      if (roleTier && stdTier && (roleTier.price !== stdTier.price || roleTier.enabled !== stdTier.enabled)) {
        return true;
      }
    }
    return false;
  }

  addMemberPrice() {
    const model = structuredClone(this.productModel());
    const baseRole = this.standardRole();
    for (const r of this.attendanceRows) {
      const stdKey = getPricingTierKey(baseRole, r.attendance, r.includeVideo);
      const memberKey = getPricingTierKey('member', r.attendance, r.includeVideo);
      const stdTier = model.tiers[stdKey];
      if (stdTier) {
        model.tiers[memberKey] = { enabled: stdTier.enabled, price: stdTier.price };
      }
    }
    this.productModel.set(model);
    this.hasMemberPrice.set(true);
  }

  removeMemberPrice() {
    this.hasMemberPrice.set(false);
  }

  addInstructorPrice() {
    const model = structuredClone(this.productModel());
    const baseRole: AttendeeRole = (this.hasMemberPrice() && this.registrationAudience() === 'anyone') ? 'member' : this.standardRole();
    for (const r of this.attendanceRows) {
      const baseKey = getPricingTierKey(baseRole, r.attendance, r.includeVideo);
      const instructorKey = getPricingTierKey('instructor', r.attendance, r.includeVideo);
      const baseTier = model.tiers[baseKey];
      if (baseTier) {
        model.tiers[instructorKey] = { enabled: baseTier.enabled, price: baseTier.price };
      }
    }
    this.productModel.set(model);
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

  getTier(role: AttendeeRole, attendance: AttendanceType, includeVideo: boolean) {
    const key = getPricingTierKey(role, attendance, includeVideo);
    const tiers = this.productModel().tiers;
    if (!tiers[key]) {
      tiers[key] = { enabled: true, price: 0 };
    }
    return tiers[key];
  }

  setTierEnabled(role: AttendeeRole, attendance: AttendanceType, includeVideo: boolean, enabled: boolean) {
    const key = getPricingTierKey(role, attendance, includeVideo);
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

  setTierPrice(role: AttendeeRole, attendance: AttendanceType, includeVideo: boolean, priceStr: string) {
    const key = getPricingTierKey(role, attendance, includeVideo);
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

  async saveProduct() {
    const model = structuredClone(this.productModel());
    if (!model.title.trim()) {
      this.errorMessage.set('Product title is required.');
      return;
    }

    model.hasMemberPrice = this.hasMemberPrice();
    model.hasInstructorPrice = this.hasInstructorPrice();
    model.allowVideoOnly = false;

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

    // Sync member tiers to standard if special member price is not active
    if (!this.hasMemberPrice()) {
      const baseRole = this.standardRole();
      for (const r of this.attendanceRows) {
        const baseKey = getPricingTierKey(baseRole, r.attendance, r.includeVideo);
        const memberKey = getPricingTierKey('member', r.attendance, r.includeVideo);
        const baseTier = model.tiers[baseKey];
        if (baseTier) {
          model.tiers[memberKey] = { enabled: baseTier.enabled, price: baseTier.price };
        }
      }
    }

    // Sync instructor tiers if special instructor price is not active
    if (!this.hasInstructorPrice()) {
      const baseRole: AttendeeRole = (this.hasMemberPrice() && audience === 'anyone') ? 'member' : this.standardRole();
      for (const r of this.attendanceRows) {
        const baseKey = getPricingTierKey(baseRole, r.attendance, r.includeVideo);
        const instructorKey = getPricingTierKey('instructor', r.attendance, r.includeVideo);
        const baseTier = model.tiers[baseKey];
        if (baseTier) {
          model.tiers[instructorKey] = { enabled: baseTier.enabled, price: baseTier.price };
        }
      }
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    try {
      const savedDocId = await this.productService.saveProduct(model);
      if (this.embedded()) {
        this.productSaved.emit(savedDocId);
      } else {
        const targetUrl = this.routingService.hrefForView(Views.ProductView, { productId: savedDocId });
        this.routingService.navigateTo(targetUrl);
      }
    } catch (err: unknown) {
      console.error('Error saving product:', err);
      this.errorMessage.set(err instanceof Error ? err.message : 'Failed to save product.');
      this.isSaving.set(false);
    }
  }

  async deleteProduct() {
    const id = this.effectiveProductId();
    if (!id) return;

    if (!confirm('Are you sure you want to delete this product? This action cannot be undone.')) {
      return;
    }

    this.isSaving.set(true);
    try {
      await this.productService.deleteProduct(id);
      if (this.embedded()) {
        this.productSaved.emit('');
      } else {
        const targetUrl = this.routingService.hrefForView(Views.ManageProducts);
        this.routingService.navigateTo(targetUrl);
      }
    } catch (err) {
      console.error('Error deleting product:', err);
      alert('Failed to delete product.');
      this.isSaving.set(false);
    }
  }
}
