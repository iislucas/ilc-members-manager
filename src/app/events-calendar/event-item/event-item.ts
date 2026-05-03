import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { IlcEvent } from '../../../../functions/src/data-model';
import { IconComponent } from '../../icons/icon.component';
import { formatDateRange } from '../format-date-range';
import { FindInstructorsService } from '../../find-instructors.service';

@Component({
  selector: 'app-event-item',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './event-item.html',
  styleUrl: './event-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventItemComponent {
  private findInstructorsService = inject(FindInstructorsService);

  event = input.required<IlcEvent>();
  readonly dateDisplay = computed(() => formatDateRange(this.event().start, this.event().end));

  // Optional prefix for instructor profile links. When empty (default),
  // the component uses the in-app hash route. When set (e.g. by the
  // standalone WC), links point to the specified base URL.
  instructorLinkPrefix = input<string>('');

  // Resolve the leading instructor to a display label: "Name (InstructorId)".
  readonly instructorLabel = computed(() => {
    const id = this.event().leadingInstructorId;
    if (!id) return '';
    const instructor = this.findInstructorsService.instructors.get(id);
    if (instructor) {
      return `${instructor.name} (${id})`;
    }
    return id;
  });

  // Build a link to the Find an Instructor view.
  readonly instructorLink = computed(() => {
    const id = this.event().leadingInstructorId;
    if (!id) return '';
    const prefix = this.instructorLinkPrefix();
    if (prefix) {
      return `${prefix}${encodeURIComponent(id)}`;
    }
    return `#/find-an-instructor?instructorId=${encodeURIComponent(id)}`;
  });

  // Resolve the event owner (contact) to a display label.
  // Only shows when the owner is different from the leading instructor.
  readonly contactLabel = computed(() => {
    const ownerDocId = this.event().ownerDocId;
    if (!ownerDocId) return '';
    const owner = this.findInstructorsService.instructors.entries().find(i => i.docId === ownerDocId);
    if (!owner) return '';
    // Don't duplicate if the owner is already shown as the instructor.
    if (owner.instructorId === this.event().leadingInstructorId) return '';
    return owner.name;
  });

  // Build a link to the owner's instructor profile.
  readonly contactLink = computed(() => {
    const ownerDocId = this.event().ownerDocId;
    if (!ownerDocId) return '';
    const owner = this.findInstructorsService.instructors.entries().find(i => i.docId === ownerDocId);
    if (!owner || !owner.instructorId) return '';
    if (owner.instructorId === this.event().leadingInstructorId) return '';
    const prefix = this.instructorLinkPrefix();
    if (prefix) {
      return `${prefix}${encodeURIComponent(owner.instructorId)}`;
    }
    return `#/find-an-instructor?instructorId=${encodeURIComponent(owner.instructorId)}`;
  });

  readonly expandMoreName = 'expand_more' as const;
  readonly expandLessName = 'expand_less' as const;
  expandIconName = signal<'expand_more' | 'expand_less'>(this.expandMoreName);

  toggleExpansion(): void {
    if (this.expandIconName() === this.expandLessName) {
      this.expandIconName.set(this.expandMoreName);
    } else {
      this.expandIconName.set(this.expandLessName);
    }
  }
}
