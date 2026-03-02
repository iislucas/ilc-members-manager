import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { Order } from '../../../functions/src/data-model';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

type SearchMode = 'recent' | 'term' | 'date';
type SearchField = 'orderNumber' | 'referenceNumber' | 'id' | 'customerEmail' | 'email' | 'lastName' | 'billingAddress.lastName';

const VALID_SEARCH_MODES: SearchMode[] = ['recent', 'term', 'date'];
const VALID_SEARCH_FIELDS: SearchField[] = ['orderNumber', 'referenceNumber', 'id', 'customerEmail', 'email', 'lastName', 'billingAddress.lastName'];

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

  public orders = signal<Order[]>([]);
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
  private syncUrlParams() {
    this.orderSignals.urlParams['searchMode'].set(this.searchMode());
    this.orderSignals.urlParams['searchField'].set(this.searchField());
    this.orderSignals.urlParams['q'].set(this.searchTerm());
    this.orderSignals.urlParams['startDate'].set(this.startDate());
    this.orderSignals.urlParams['endDate'].set(this.endDate());
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
      this.orders.update(orders => orders.map(o => o.docId === updatedOrder.docId ? updatedOrder : o));
    }
  }

  async markAsIgnored(order: Order, event: Event) {
    event.stopPropagation();
    this.openMenuId.set(null);
    const updatedOrder = { ...order, ilcAppOrderStatus: 'ignore' as const, ilcAppOrderIssues: [] };
    await this.dataService.updateOrder(order.docId, updatedOrder);
    this.orders.update(orders => orders.map(o => o.docId === updatedOrder.docId ? updatedOrder : o));
  }

  async markAsTodo(order: Order, event: Event) {
    event.stopPropagation();
    this.openMenuId.set(null);
    const updatedOrder = { ...order, ilcAppOrderStatus: 'needs-manual-processing' as const };
    await this.dataService.updateOrder(order.docId, updatedOrder);
    this.orders.update(orders => orders.map(o => o.docId === updatedOrder.docId ? updatedOrder : o));
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
      const results = await this.dataService.getRecentOrders(50);
      this.orders.set(results);
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
        });
      } else {
        results = await this.dataService.searchOrders({
          kind: 'date',
          startDate: start,
          endDate: end,
        });
      }
      this.orders.set(results);
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
