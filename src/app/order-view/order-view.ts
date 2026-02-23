import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { Order } from '../../../functions/src/data-model';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-order-view',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent],
  templateUrl: './order-view.html',
  styleUrl: './order-view.scss',
})
export class OrderView {
  private dataService = inject(DataManagerService);
  private routingService = inject(RoutingService<AppPathPatterns>);

  public orderId = this.routingService.signals[Views.OrderView].pathVars['orderId'];
  public order = signal<Order | null>(null);
  public loading = signal(false);
  public error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.orderId();
      if (id) {
        this.fetchOrder(id);
      }
    });
  }

  async fetchOrder(id: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.dataService.getOrderByIdOrRef(id);
      if (result) {
        this.order.set(result);
      } else {
        this.error.set('Order not found');
      }
    } catch (e: any) {
      this.error.set(e.message || 'Failed to fetch order');
    } finally {
      this.loading.set(false);
    }
  }

  goBack() {
    this.routingService.navigateTo('orders');
  }
}
