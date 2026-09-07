/* manage-products.ts
 *
 * Admin catalogue page for managing class and workshop products.
 * Lists all existing products, their linked events, and provides access to creation and editing.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
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
import { IlcEvent, Product } from '../../../functions/src/data-model/events';

@Component({
  selector: 'app-manage-products',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './manage-products.html',
  styleUrl: './manage-products.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManageProductsComponent implements OnInit {
  protected routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  protected firebaseState = inject(FirebaseStateService);
  protected dataService = inject(DataManagerService);
  protected productService = inject(ProductService);
  protected readonly Views = Views;

  isLoading = signal(true);
  searchTerm = signal('');
  products = signal<Product[]>([]);
  eventsMap = signal<Map<string, IlcEvent>>(new Map());

  filteredProducts = computed(() => {
    const q = this.searchTerm().toLowerCase().trim();
    const list = this.products();
    if (!q) return list;
    const evMap = this.eventsMap();
    return list.filter((p) => {
      const titleMatch = p.title.toLowerCase().includes(q);
      const ev = p.eventDocId ? evMap.get(p.eventDocId) : undefined;
      const eventMatch = ev ? ev.title.toLowerCase().includes(q) : false;
      return titleMatch || eventMatch;
    });
  });

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadData();
  }

  async loadData() {
    this.isLoading.set(true);
    try {
      const [prods, events] = await Promise.all([
        this.productService.getAllProducts(),
        this.dataService.getEvents(),
      ]);

      const map = new Map<string, IlcEvent>();
      for (const ev of events) {
        map.set(ev.docId, ev);
      }
      this.eventsMap.set(map);
      this.products.set(prods);
    } catch (err) {
      console.error('Error loading products list:', err);
    } finally {
      this.isLoading.set(false);
    }
  }

  getLinkedEventTitle(eventDocId: string): string {
    if (!eventDocId) return 'None';
    const ev = this.eventsMap().get(eventDocId);
    return ev ? ev.title : eventDocId;
  }
}
