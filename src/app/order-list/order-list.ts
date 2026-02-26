import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataManagerService } from '../data-manager.service';
import { Order } from '../../../functions/src/data-model';
import { RoutingService } from '../routing.service';
import { AppPathPatterns } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './order-list.html',
  styleUrl: './order-list.scss',
})
export class OrderList implements OnInit {
  private dataService = inject(DataManagerService);
  private routingService = inject(RoutingService<AppPathPatterns>);

  public searchMode = signal<'recent' | 'term' | 'date'>('recent');
  public searchField = signal<'orderNumber' | 'referenceNumber' | 'id' | 'customerEmail' | 'email' | 'lastName' | 'billingAddress.lastName'>('email');
  public searchTerm = signal('');
  public startDate = signal<string>('');
  public endDate = signal<string>('');

  public orders = signal<Order[]>([]);
  public loading = signal(false);
  public searched = signal(false); // Indicates if A search was performed, although by default we also load recent.
  public syncing = signal(false);
  public menuOpen = signal(false);

  async setSearchMode(mode: 'recent' | 'term' | 'date') {
    this.searchMode.set(mode);
    if (mode === 'recent') {
      this.searchTerm.set('');
      this.startDate.set('');
      this.endDate.set('');
      this.searched.set(false);
      await this.loadRecentOrders();
    } else if (mode === 'date') {
      await this.search();
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

  ngOnInit() {
    this.loadRecentOrders();
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
      await this.loadRecentOrders();
      return;
    }
    if (mode === 'term' && !term) {
      this.searched.set(false);
      await this.loadRecentOrders();
      return;
    }

    this.loading.set(true);
    this.searched.set(true);
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
