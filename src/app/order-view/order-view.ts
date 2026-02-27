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
  public reprocessing = signal(false);

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

  async reprocessOrder() {
    const id = this.order()?.docId;
    if (!id) return;

    if (
      !confirm(
        'Are you sure you want to re-process this order? Existing data (like Video Library subscriptions and Pending Gradings) will be checked safely, but ensure this actually needs re-processing.',
      )
    ) {
      return;
    }

    this.reprocessing.set(true);
    try {
      await this.dataService.reprocessOrder(id);
      // Refresh the order to show the updated processing status
      await this.fetchOrder(this.orderId());
    } catch (e: unknown) {
      alert(`Error reprocessing order: ${(e as Error).message}`);
    } finally {
      this.reprocessing.set(false);
    }
  }
}
