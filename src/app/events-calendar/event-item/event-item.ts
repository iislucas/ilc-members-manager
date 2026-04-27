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
