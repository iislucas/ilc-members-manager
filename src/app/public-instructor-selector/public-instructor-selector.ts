import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { InstructorSelectorComponent } from '../instructor-selector/instructor-selector';
import { IconComponent } from '../icons/icon.component';
import { InstructorPublicData } from '../../../functions/src/data-model';

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
  // Shown in the display row when there is no committed value.
  emptyLabel = input<string>('None selected');
  // Label for the button that opens the selector when nothing is chosen yet.
  selectLabel = input<string>('Select instructor');

  // Whether the search-and-preview editor is open.
  isEditing = signal(false);
  // Working copy of the instructorId while editing; committed on Set.
  draft = signal<string>('');

  // The instructor the committed value resolves to, if any.
  selectedInstructor = computed<InstructorPublicData | null>(() => {
    const val = this.value();
    if (!val) return null;
    return this.dataService.instructors.get(val) ?? null;
  });

  // Set is only allowed once the draft resolves to a real public instructor.
  canSet = computed<boolean>(() => !!this.dataService.instructors.get(this.draft()));

  startEdit() {
    this.draft.set(this.value());
    this.isEditing.set(true);
  }

  setValue() {
    if (!this.canSet()) return;
    this.valueChange.emit(this.draft());
    this.isEditing.set(false);
  }

  cancel() {
    this.isEditing.set(false);
  }
}
