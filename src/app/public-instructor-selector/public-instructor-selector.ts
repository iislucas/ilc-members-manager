import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { InstructorSelectorComponent } from '../instructor-selector/instructor-selector';
import { IconComponent } from '../icons/icon.component';
import {
  InstructorPublicData,
  isValidInstructorId,
} from '../../../functions/src/data-model/members';

/**
 * A compact picker for a single ILC public instructor.
 *
 * When a valid instructor is selected it shows "Name [instructorId]" with a view
 * link (to the public profile) and an edit button. Pressing edit reveals the
 * search-and-preview selector (app-instructor-selector) with local Set / Cancel
 * buttons — the parent only hears about the change when Set is pressed.
 *
 * Works entirely in human-readable instructorId space: `value` in and
 * `valueChange` out are instructorIds (empty string = nothing selected).
 */
@Component({
  selector: 'app-public-instructor-selector',
  standalone: true,
  imports: [InstructorSelectorComponent, IconComponent],
  templateUrl: './public-instructor-selector.html',
  styleUrl: './public-instructor-selector.scss',
})
export class PublicInstructorSelectorComponent {
  private dataService = inject(DataManagerService);

  // The committed instructorId (or '' when nothing is selected).
  value = input.required<string>();
  // Emitted only when the user presses "Set", carrying the new instructorId.
  valueChange = output<string>();

  placeholder = input<string>('Search for an instructor');
  name = input<string>('');
  disabled = input<boolean>(false);
  allowClear = input<boolean>(false);
  // Shown in the display row when there is no committed value.
  emptyLabel = input<string>('None selected');
  // Label for the button that opens the selector when nothing is chosen yet.
  selectLabel = input<string>('Select instructor');

  // Whether the search-and-preview editor is open.
  isEditing = signal(false);
  // Working copy of the instructorId while editing; committed on Set.
  draft = signal<string>('');

  // True while the instructors directory is still performing its initial load.
  instructorsLoading = computed<boolean>(() => this.dataService.instructors.loading());

  // True when a non-empty committed value is not a valid numerical Instructor ID.
  hasInvalidFormat = computed<boolean>(() => {
    const val = this.value().trim();
    return val !== '' && !isValidInstructorId(val);
  });

  // The instructor the committed value resolves to, if any.
  selectedInstructor = computed<InstructorPublicData | null>(() => {
    const val = this.value().trim();
    if (!val || !isValidInstructorId(val)) return null;
    return this.dataService.instructors.get(val) ?? null;
  });

  // Set is only allowed once the draft is a strictly numerical Instructor ID
  // that resolves to a real public instructor (not a Member ID or name).
  canSet = computed<boolean>(() => {
    const d = this.draft().trim();
    return isValidInstructorId(d) && !!this.dataService.instructors.get(d);
  });

  startEdit() {
    if (this.disabled()) return;
    this.draft.set(this.value());
    this.isEditing.set(true);
  }

  setValue() {
    if (!this.canSet()) return;
    this.valueChange.emit(this.draft().trim());
    this.isEditing.set(false);
  }

  clearValue() {
    if (this.disabled() || !this.allowClear()) return;
    this.draft.set('');
    this.valueChange.emit('');
    this.isEditing.set(false);
  }

  cancel() {
    this.isEditing.set(false);
  }
}
