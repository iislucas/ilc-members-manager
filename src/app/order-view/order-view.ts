import { Component, effect, inject, signal, computed, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataManagerService } from '../data-manager.service';
import { Order, OrderStatus, OrderKind, SquarespaceFulfillmentStatus } from '../../../functions/src/data-model';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { SquarespaceOrderView } from './squarespace-order-view/squarespace-order-view';
import { SheetOrderView } from './sheet-order-view/sheet-order-view';
import { StripeOrderView } from './stripe-order-view/stripe-order-view';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-order-view',
  standalone: true,
  imports: [CommonModule, IconComponent, SpinnerComponent, SquarespaceOrderView, SheetOrderView, StripeOrderView, FormsModule],
  templateUrl: './order-view.html',
  styleUrl: './order-view.scss',
})
export class OrderView {
  protected readonly OrderKind = OrderKind;
  protected readonly OrderStatus = OrderStatus;
  private dataService = inject(DataManagerService);
  public routingService = inject(RoutingService<AppPathPatterns>);

  public orderId = this.routingService.signals[Views.OrderView].pathVars['orderId'];
  public order = signal<Order | null>(null);
  public titleLoaded = output<string>();
  public loading = signal(false);
  public error = signal<string | null>(null);
  public reprocessing = signal(false);
  public notesInput = signal<string | undefined>(undefined);
  public savingNotes = signal(false);
  public menuOpen = signal(false);

  public notesChanged = computed(() => {
    const input = this.notesInput();
    if (input === undefined) return false;
    return input !== (this.order()?.ilcAppNotes || '');
  });

  constructor() {
    effect(() => {
      const id = this.orderId();
      if (id) {
        this.fetchOrder(id);
      }
    });
  }

  computeOrderTitle(o: Order): string {
    if (o.ilcAppOrderKind === OrderKind.Squarespace) {
      const name = [o.billingAddress?.firstName, o.billingAddress?.lastName].filter(Boolean).join(' ');
      const date = o.createdOn ? new Date(o.createdOn).toLocaleDateString() : '';
      return `Order #${o.orderNumber} - ${date} - ${name}`;
    } else if (o.ilcAppOrderKind === OrderKind.Stripe) {
      const date = o.created ? new Date(o.created).toLocaleDateString() : '';
      const name = o.customerName || o.customerEmail || '';
      return `Stripe ${o.stripeOrderType} - ${date} - ${name}`;
    }
    // (o.ilcAppOrderKind === OrderKind.SheetsImport)
    else {
      const name = [o.firstName, o.lastName].filter(Boolean).join(' ');
      return `Order #${o.referenceNumber} - ${o.datePaid} - ${name}`;
    }
  }

  async fetchOrder(id: string) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.dataService.getOrderByIdOrRef(id);
      if (result) {
        this.order.set(result);
        this.titleLoaded.emit(this.computeOrderTitle(result));
      } else {
        this.error.set('Order not found');
        this.titleLoaded.emit('Order Not Found');
      }
    } catch (e: any) {
      this.error.set(e.message || 'Failed to fetch order');
      this.titleLoaded.emit('Error Loading Order');
    } finally {
      this.loading.set(false);
    }
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

  onNotesInput(value: string) {
    this.notesInput.set(value);
  }

  async saveNotes() {
    const o = this.order();
    if (!o) return;
    const notes = this.notesInput() ?? '';

    this.savingNotes.set(true);
    try {
      await this.dataService.updateOrderNotes(o.docId, notes);
      // Refresh order and reset input tracking
      await this.fetchOrder(this.orderId());
      this.notesInput.set(undefined);
    } catch (e: unknown) {
      alert(`Error saving notes: ${(e as Error).message}`);
    } finally {
      this.savingNotes.set(false);
    }
  }

  async setOrderStatus(status: OrderStatus) {
    const o = this.order();
    if (!o) return;

    try {
      const updatedOrder = { ...o, ilcAppOrderStatus: status };
      if (status === OrderStatus.Processed || status === OrderStatus.Ignore) {
        updatedOrder.ilcAppOrderIssues = [];
      }
      await this.dataService.updateOrder(o.docId, updatedOrder);
      await this.fetchOrder(this.orderId());
    } catch (e: unknown) {
      alert(`Error updating order status: ${(e as Error).message}`);
    }
  }

  async markAsFulfilled() {
    const o = this.order();
    if (!o) return;

    try {
      const updatedOrder = { ...o, fulfillmentStatus: SquarespaceFulfillmentStatus.Fulfilled };
      await this.dataService.updateOrder(o.docId, updatedOrder);
      await this.fetchOrder(this.orderId());
    } catch (e: unknown) {
      alert(`Error marking as fulfilled: ${(e as Error).message}`);
    }
  }
}
