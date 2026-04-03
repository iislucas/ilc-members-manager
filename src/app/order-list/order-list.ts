import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { Order, SquareSpaceOrder } from '../../../functions/src/data-model';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

type SearchMode = 'recent' | 'term' | 'date';
type SearchField = 'orderNumber' | 'referenceNumber' | 'id' | 'customerEmail' | 'email' | 'lastName' | 'billingAddress.lastName';

const VALID_SEARCH_MODES: SearchMode[] = ['recent', 'term', 'date'];
const VALID_SEARCH_FIELDS: SearchField[] = ['orderNumber', 'referenceNumber', 'id', 'customerEmail', 'email', 'lastName', 'billingAddress.lastName'];

function getOrderRank(order: Order): number {
  if (order.ilcAppOrderStatus === 'error') {
    return 1;
  }
  if (order.ilcAppOrderStatus === 'needs-manual-processing' || ('fulfillmentStatus' in order && order.fulfillmentStatus === 'PENDING')) {
    return 2;
  }
  if (order.ilcAppOrderStatus === 'processed') {
    return 3;
  }
  if (order.ilcAppOrderStatus === 'ignore') {
    return 4;
  }
  return 5;
}

function compareOrdersByDefault(a: Order, b: Order): number {
  const rA = getOrderRank(a);
  const rB = getOrderRank(b);
  if (rA !== rB) {
    return rA - rB;
  }
  return (b.lastUpdated || '').localeCompare(a.lastUpdated || '');
}

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './order-list.html',
  styleUrl: './order-list.scss',
})
export class OrderList {
  private dataService = inject(DataManagerService);
  private routingService = inject(RoutingService<AppPathPatterns>);
  private orderSignals = this.routingService.signals[Views.ManageOrders];

  public searchMode = signal<SearchMode>('recent');
  public searchField = signal<SearchField>('email');
  public searchTerm = signal('');
  public startDate = signal<string>('');
  public endDate = signal<string>('');

  public sortField = signal<string>('default');
  public sortDirection = signal<'asc' | 'desc'>('desc');
  public statusFilter = signal<string>('');
  public kindFilter = signal<string>('');
  public filterMenuOpen = signal(false);

  public rawOrders = signal<Order[]>([]);
  public orders = computed(() => {
    const raw = this.rawOrders();
    const field = this.sortField();
    const dir = this.sortDirection();
    const status = this.statusFilter();
    const kind = this.kindFilter();

    let filtered = raw;
    if (status) {
      filtered = raw.filter((o) => o.ilcAppOrderStatus === status);
    }
    if (kind === 'squarespace') {
      filtered = filtered.filter(
        (o) =>
          o.ilcAppOrderKind ===
          'https://api.squarespace.com/1.0/commerce/orders'
      );
    }

    const mul = dir === 'asc' ? 1 : -1;

    return [...filtered].sort((a, b) => {
      if (field === 'default') {
        return compareOrdersByDefault(a, b);
      }
      if (field === 'date') {
        return mul * (a.lastUpdated || '').localeCompare(b.lastUpdated || '');
      }
      if (field === 'status') {
        const sA = a.ilcAppOrderStatus || '';
        const sB = b.ilcAppOrderStatus || '';
        if (sA !== sB) return mul * sA.localeCompare(sB);
        return (b.lastUpdated || '').localeCompare(a.lastUpdated || '');
      }
      return 0;
    });
  });
  public loading = signal(false);
  public searched = signal(false); // Indicates if A search was performed, although by default we also load recent.
  public syncing = signal(false);
  public menuOpen = signal(false);
  public openMenuId = signal<string | null>(null);

  private initialised = false;

  constructor() {
    // Read URL params on init and trigger the appropriate search.
    effect(() => {
      const urlMode = this.orderSignals.urlParams['searchMode']() as SearchMode;
      const urlField = this.orderSignals.urlParams['searchField']() as SearchField;
      const urlQ = this.orderSignals.urlParams['q']();
      const urlStart = this.orderSignals.urlParams['startDate']();
      const urlEnd = this.orderSignals.urlParams['endDate']();
      const urlSortBy = this.orderSignals.urlParams['sortBy']();
      const urlSortDir = this.orderSignals.urlParams['sortDir']();
      const urlStatus = this.orderSignals.urlParams['status']();
      const urlKind = this.orderSignals.urlParams['kind']();

      // Only apply URL → local signals on first run.
      if (this.initialised) return;
      this.initialised = true;

      const mode: SearchMode = VALID_SEARCH_MODES.includes(urlMode) ? urlMode : 'recent';
      const field: SearchField = VALID_SEARCH_FIELDS.includes(urlField) ? urlField : 'email';

      this.searchMode.set(mode);
      this.searchField.set(field);
      this.searchTerm.set(urlQ || '');
      this.startDate.set(urlStart || '');
      this.endDate.set(urlEnd || '');
      this.sortField.set(urlSortBy || 'default');
      this.sortDirection.set((urlSortDir === 'asc' || urlSortDir === 'desc') ? urlSortDir : 'desc');
      this.statusFilter.set(urlStatus || '');
      this.kindFilter.set(urlKind || '');

      if (mode === 'term' && urlQ) {
        this.search();
      } else if (mode === 'date' && (urlStart || urlEnd)) {
        this.search();
      } else {
        this.loadRecentOrders();
      }
    });
  }

  /** Write current search state into URL params so the URL is shareable. */
  public syncUrlParams() {
    this.orderSignals.urlParams['searchMode'].set(this.searchMode());
    this.orderSignals.urlParams['searchField'].set(this.searchField());
    this.orderSignals.urlParams['q'].set(this.searchTerm());
    this.orderSignals.urlParams['startDate'].set(this.startDate());
    this.orderSignals.urlParams['endDate'].set(this.endDate());
    this.orderSignals.urlParams['sortBy'].set(this.sortField());
    this.orderSignals.urlParams['sortDir'].set(this.sortDirection());
    this.orderSignals.urlParams['status'].set(this.statusFilter());
    this.orderSignals.urlParams['kind'].set(this.kindFilter());
  }

  public onFilterChange() {
    this.onFilterChangeSilently();
    this.triggerFilterLoad();
  }

  private onFilterChangeSilently() {
    this.syncUrlParams();
  }

  private triggerFilterLoad() {
    if (this.searchMode() === 'term' && this.searchTerm()) {
      this.search();
    } else if (this.searchMode() === 'date' && (this.startDate() || this.endDate())) {
      this.search();
    } else {
      this.loadRecentOrders();
    }
  }

  toggleOrderMenu(docId: string, event: Event) {
    event.stopPropagation();
    if (this.openMenuId() === docId) {
      this.openMenuId.set(null);
    } else {
      this.openMenuId.set(docId);
    }
  }

  async markAsFulfilled(order: Order, event: Event) {
    event.stopPropagation();
    this.openMenuId.set(null);
    if (order.ilcAppOrderKind === 'https://api.squarespace.com/1.0/commerce/orders') {
      const updatedOrder = { ...order, fulfillmentStatus: 'FULFILLED' as const };
      await this.dataService.updateOrder(order.docId, updatedOrder);
      this.rawOrders.update(orders => orders.map(o => o.docId === updatedOrder.docId ? updatedOrder : o));
    }
  }

  async markAsIgnored(order: Order, event: Event) {
    event.stopPropagation();
    this.openMenuId.set(null);
    const updatedOrder = { ...order, ilcAppOrderStatus: 'ignore' as const, ilcAppOrderIssues: [] };
    await this.dataService.updateOrder(order.docId, updatedOrder);
    this.rawOrders.update(orders => orders.map(o => o.docId === updatedOrder.docId ? updatedOrder : o));
  }

  async markAsTodo(order: Order, event: Event) {
    event.stopPropagation();
    this.openMenuId.set(null);
    const updatedOrder = { ...order, ilcAppOrderStatus: 'needs-manual-processing' as const };
    await this.dataService.updateOrder(order.docId, updatedOrder);
    this.rawOrders.update(orders => orders.map(o => o.docId === updatedOrder.docId ? updatedOrder : o));
  }

  async setSearchMode(mode: SearchMode) {
    this.searchMode.set(mode);
    if (mode === 'recent') {
      this.searchTerm.set('');
      this.startDate.set('');
      this.endDate.set('');
      this.searched.set(false);
      this.syncUrlParams();
      await this.loadRecentOrders();
    } else if (mode === 'date') {
      this.syncUrlParams();
      await this.search();
    } else {
      this.syncUrlParams();
    }
  }

  toggleMenu() {
    this.menuOpen.update((v) => !v);
  }

  toggleSortDirection() {
    this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    this.syncUrlParams();
  }

  async manualSync() {
    this.syncing.set(true);
    this.menuOpen.set(false);
    try {
      await this.dataService.syncSquarespaceOrders();
      await this.loadRecentOrders();
    } catch (e) {
      console.error('Error manual syncing:', e);
      alert('Error triggering sync: ' + e);
    } finally {
      this.syncing.set(false);
    }
  }

  async loadRecentOrders() {
    this.loading.set(true);
    try {
      const results = await this.dataService.getRecentOrders(50, this.statusFilter(), this.kindFilter());
      this.rawOrders.set(results);
    } catch (e) {
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  async search() {
    const mode = this.searchMode();
    const field = this.searchField();
    const term = this.searchTerm().trim();
    const start = this.startDate();
    const end = this.endDate();

    if (mode === 'recent') {
      this.searched.set(false);
      this.syncUrlParams();
      await this.loadRecentOrders();
      return;
    }
    if (mode === 'term' && !term) {
      this.searched.set(false);
      this.syncUrlParams();
      await this.loadRecentOrders();
      return;
    }

    this.loading.set(true);
    this.searched.set(true);
    this.syncUrlParams();
    try {
      let results: Order[] = [];
      if (mode === 'term') {
        results = await this.dataService.searchOrders({
          kind: 'term',
          searchField: field,
          term,
          statusFilter: this.statusFilter(),
          kindFilter: this.kindFilter(),
        });
      } else {
        results = await this.dataService.searchOrders({
          kind: 'date',
          startDate: start,
          endDate: end,
          statusFilter: this.statusFilter(),
          kindFilter: this.kindFilter(),
        });
      }
      this.rawOrders.set(results);
    } catch (e) {
      console.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  viewOrder(order: Order) {
    this.routingService.navigateTo('order-view/' + order.docId);
  }
}
