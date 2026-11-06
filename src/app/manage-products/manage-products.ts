/* manage-products.ts
 *
 * Admin catalogue page for managing class and workshop registration setups.
 * Lists all live products alongside unpublished registration drafts, their linked events,
 * and provides direct access to editing, resuming, or discarding drafts.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ProductService } from '../product.service';
import {
  areProductsEquivalentForDraft,
  ProductDraftService,
} from '../product-draft.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import {
  formatProductPriceRange,
  IlcEvent,
  Product,
  ProductDraft,
} from '../../../functions/src/data-model/events';

export interface RegistrationCatalogueItem {
  key: string;
  product: Product;
  draft: ProductDraft | null;
  isDraftOnly: boolean;
}

@Component({
  selector: 'app-manage-products',
  standalone: true,
  imports: [FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './manage-products.html',
  styleUrl: './manage-products.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageProductsComponent implements OnInit {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected productDraftService = inject(ProductDraftService);
  protected readonly Views = Views;

  isLoading = signal(true);
  searchTerm = signal('');
  products = signal<Product[]>([]);
  drafts = signal<ProductDraft[]>([]);
  eventsMap = signal<Map<string, IlcEvent>>(new Map());
  confirmingDiscardDraftId = signal<string | null>(null);

  catalogueItems = computed<RegistrationCatalogueItem[]>(() => {
    const liveProducts = this.products();
    const allDrafts = this.drafts();

    const draftByEventId = new Map<string, ProductDraft>();
    const draftByProductId = new Map<string, ProductDraft>();
    for (const d of allDrafts) {
      if (d.eventDocId) {
        draftByEventId.set(d.eventDocId, d);
      }
      if (d.productDocId) {
        draftByProductId.set(d.productDocId, d);
      }
    }

    const matchedDraftIds = new Set<string>();
    const liveItems: RegistrationCatalogueItem[] = liveProducts.map((product, index) => {
      const candidate =
        (product.eventDocId ? draftByEventId.get(product.eventDocId) : undefined) ??
        (product.docId ? draftByProductId.get(product.docId) : undefined);

      let effectiveDraft: ProductDraft | null = null;
      if (candidate) {
        matchedDraftIds.add(candidate.docId);
        const isCleanIdentical =
          (!candidate.baseProductLastUpdated ||
            candidate.baseProductLastUpdated === product.lastUpdated) &&
          areProductsEquivalentForDraft(candidate.draftProduct, product);
        if (!isCleanIdentical) {
          effectiveDraft = candidate;
        }
      }

      return {
        key: product.docId || `live_${product.eventDocId || index}`,
        product,
        draft: effectiveDraft,
        isDraftOnly: false,
      };
    });

    const draftOnlyItems: RegistrationCatalogueItem[] = [];
    for (const d of allDrafts) {
      if (matchedDraftIds.has(d.docId)) continue;
      const eventDocId = d.eventDocId || d.draftProduct.eventDocId;
      if (!eventDocId) continue;
      draftOnlyItems.push({
        key: `draft_${d.docId}`,
        product: {
          ...d.draftProduct,
          eventDocId,
        },
        draft: d,
        isDraftOnly: true,
      });
    }

    draftOnlyItems.sort((a, b) => {
      const timeA = a.draft?.clientSavedAt || a.draft?.lastUpdated || '';
      const timeB = b.draft?.clientSavedAt || b.draft?.lastUpdated || '';
      return timeB.localeCompare(timeA);
    });

    return [...draftOnlyItems, ...liveItems];
  });

  filteredItems = computed<RegistrationCatalogueItem[]>(() => {
    const q = this.searchTerm().toLowerCase().trim();
    const list = this.catalogueItems();
    if (!q) return list;
    const evMap = this.eventsMap();
    return list.filter((item) => {
      const p = item.product;
      const titleMatch = p.title.toLowerCase().includes(q);
      const draftTitleMatch = item.draft
        ? item.draft.draftProduct.title.toLowerCase().includes(q)
        : false;
      const ev = p.eventDocId ? evMap.get(p.eventDocId) : undefined;
      const eventMatch = ev ? ev.title.toLowerCase().includes(q) : false;
      return titleMatch || draftTitleMatch || eventMatch;
    });
  });

  filteredProducts = computed(() => this.filteredItems().map((item) => item.product));

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadData();
  }

  async loadData() {
    this.isLoading.set(true);
    try {
      const uid = this.firebaseState.user()?.firebaseUser?.uid;
      const [prods, events, adminDrafts] = await Promise.all([
        this.productService.getAllProducts(),
        this.dataService.getEvents(),
        this.productDraftService.getAllDraftsForAdmin(uid),
      ]);

      const map = new Map<string, IlcEvent>();
      for (const ev of events) {
        map.set(ev.docId, ev);
      }
      this.eventsMap.set(map);
      this.products.set(prods);
      this.drafts.set(adminDrafts);
    } catch (err) {
      console.error('Error loading products list:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  requestDiscardDraft(draftId: string): void {
    this.confirmingDiscardDraftId.set(draftId);
  }

  cancelDiscardDraft(): void {
    this.confirmingDiscardDraftId.set(null);
  }

  async confirmDiscardDraft(draftId: string): Promise<void> {
    this.confirmingDiscardDraftId.set(null);
    this.drafts.update((list) => list.filter((d) => d.docId !== draftId));
    const uid = this.firebaseState.user()?.firebaseUser?.uid;
    await this.productDraftService.deleteDraftEverywhere(uid, draftId);
  }

  getLinkedEventTitle(eventDocId: string): string {
    if (!eventDocId) return 'None';
    const ev = this.eventsMap().get(eventDocId);
    return ev ? ev.title : eventDocId;
  }

  getPriceRange(product: Product): string {
    return formatProductPriceRange(product);
  }
}
