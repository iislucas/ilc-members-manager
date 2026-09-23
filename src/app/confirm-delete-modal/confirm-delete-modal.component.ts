/* confirm-delete-modal.component.ts
 *
 * Reusable confirmation modal dialog for high-stakes deletion actions
 * (such as deleting member accounts, schools, or gradings).
 *
 * Requires deliberate administrator confirmation to prevent accidental deletions.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-confirm-delete-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './confirm-delete-modal.component.html',
  styleUrl: './confirm-delete-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDeleteModalComponent {
  // Inputs
  isOpen = input<boolean>(false);
  title = input<string>('Confirm Permanent Deletion');
  entityType = input<string>('Member');
  entityName = input<string>('');
  entityIdentifier = input<string>('');
  warningMessage = input<string>(
    'This action is permanent and cannot be undone. Access permissions and links will be revoked. A pre-deletion snapshot is saved to audit logs.',
  );
  requireConfirmationWord = input<boolean>(true);
  confirmWord = input<string>('DELETE');

  // Outputs
  confirmed = output<void>();
  cancelled = output<void>();

  // State
  confirmationInput = signal<string>('');
  understoodRisk = signal<boolean>(false);
  isDeleting = signal<boolean>(false);

  // Validation
  canConfirm = computed(() => {
    if (this.isDeleting()) return false;
    if (!this.understoodRisk()) return false;
    if (this.requireConfirmationWord()) {
      return (
        this.confirmationInput().trim().toUpperCase() ===
        this.confirmWord().trim().toUpperCase()
      );
    }
    return true;
  });

  onConfirm(): void {
    if (!this.canConfirm()) return;
    this.isDeleting.set(true);
    this.confirmed.emit();
  }

  onCancel(): void {
    if (this.isDeleting()) return;
    this.reset();
    this.cancelled.emit();
  }

  reset(): void {
    this.confirmationInput.set('');
    this.understoodRisk.set(false);
    this.isDeleting.set(false);
  }
}
