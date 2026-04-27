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
import { DataManagerService } from '../../data-manager.service';

@Component({
  selector: 'app-event-item',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './event-item.html',
  styleUrl: './event-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventItemComponent {
  private dataService = inject(DataManagerService);

  event = input.required<IlcEvent>();
  readonly dateDisplay = computed(() => formatDateRange(this.event().start, this.event().end));

  // Resolve the leading instructor to a display label: "Name (InstructorId)".
  readonly instructorLabel = computed(() => {
    const id = this.event().leadingInstructorId;
    if (!id) return '';
    const instructor = this.dataService.instructors.get(id);
    if (instructor) {
      return `${instructor.name} (${id})`;
    }
    return id;
  });

  // Build a link to the Find an Instructor view.
  readonly instructorLink = computed(() => {
    const id = this.event().leadingInstructorId;
    if (!id) return '';
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
