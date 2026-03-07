import { Component, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SquareSpaceOrder, SquareSpaceLineItem, Member } from '../../../../functions/src/data-model';
import { DataManagerService } from '../../data-manager.service';
import { IconComponent } from '../../icons/icon.component';

@Component({
  selector: 'app-squarespace-order-view',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './squarespace-order-view.html',
  styleUrl: './squarespace-order-view.scss'
})
export class SquarespaceOrderView {
  private dataService = inject(DataManagerService);

  order = input.required<SquareSpaceOrder>();
  orderUpdated = output<void>();

  // Per-line-item UI state, keyed by line item id.
  memberLookupResults = signal<Map<string, Member[]>>(new Map());
  memberIdInputs = signal<Map<string, string>>(new Map());
  savingLineItems = signal<Set<string>>(new Set());

  lookupMemberByEmail(lineItem: SquareSpaceLineItem) {
    const email = this.getEmailForLineItem(lineItem);
    if (!email) return;

    const results = this.dataService.lookupMembersByEmail(email);
    const map = new Map(this.memberLookupResults());
    map.set(lineItem.id, results);
    this.memberLookupResults.set(map);
  }

  getEmailForLineItem(lineItem: SquareSpaceLineItem): string {
    // Try to find email in customizations first
    for (const c of lineItem.customizations || []) {
      if (c.label?.toLowerCase().includes('email') && c.value) {
        return c.value.trim();
      }
    }
    // Fall back to order customer email
    return this.order().customerEmail || '';
  }

  getInferredMemberId(lineItem: SquareSpaceLineItem): string {
    // First check the input map for unsaved edits
    const inputMap = this.memberIdInputs();
    if (inputMap.has(lineItem.id)) {
      return inputMap.get(lineItem.id) || '';
    }
    return lineItem.ilcAppMemberIdInferred || '';
  }

  setInferredMemberIdInput(lineItemId: string, value: string) {
    const map = new Map(this.memberIdInputs());
    map.set(lineItemId, value);
    this.memberIdInputs.set(map);
  }

  selectMemberForLineItem(lineItemId: string, memberId: string) {
    this.setInferredMemberIdInput(lineItemId, memberId);
  }

  async saveInferredMemberId(lineItem: SquareSpaceLineItem) {
    const memberId = this.getInferredMemberId(lineItem);
    const orderId = this.order().docId;
    if (!orderId) return;

    const saving = new Set(this.savingLineItems());
    saving.add(lineItem.id);
    this.savingLineItems.set(saving);

    try {
      await this.dataService.setOrderLineItemInferredMemberId(
        orderId, lineItem.id, memberId
      );
      // Clear the input state after successful save
      const map = new Map(this.memberIdInputs());
      map.delete(lineItem.id);
      this.memberIdInputs.set(map);
      this.orderUpdated.emit();
    } catch (e: unknown) {
      alert(`Error saving inferred member ID: ${(e as Error).message}`);
    } finally {
      const saving = new Set(this.savingLineItems());
      saving.delete(lineItem.id);
      this.savingLineItems.set(saving);
    }
  }

  hasUnsavedChange(lineItem: SquareSpaceLineItem): boolean {
    const inputMap = this.memberIdInputs();
    if (!inputMap.has(lineItem.id)) return false;
    return inputMap.get(lineItem.id) !== (lineItem.ilcAppMemberIdInferred || '');
  }
}
