import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { IlcEvent, eventContacts } from '../../../../functions/src/data-model';
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
      return `${instructor.name} [${id}]`;
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
    return `/instructors/${encodeURIComponent(id)}`;
  });

  // The event's first listed contact (the creator when none is listed), skipped
  // when it would just repeat the leading instructor shown above it. This
  // compact card has room for one contact; the event page lists them all.
  private readonly firstContact = computed(() => {
    const contact = eventContacts(this.event())[0];
    if (!contact) return null;
    // Prefer the public instructor profile over the fields cached on the event:
    // events that predate those fields have neither a name nor an instructorId
    // stored, and the profile is the more current name anyway.
    const instructors = this.findInstructorsService.instructors;
    const instructor = contact.instructorId
      ? instructors.get(contact.instructorId)
      : instructors.entries().find((i) => i.docId === contact.memberDocId);
    const instructorId = instructor?.instructorId || contact.instructorId;
    const name = instructor?.name || contact.name;
    if (!name) return null;
    // Don't repeat the leading instructor, shown above.
    if (instructorId && instructorId === this.event().leadingInstructorId) return null;
    return { name, instructorId };
  });

  readonly contactLabel = computed(() => this.firstContact()?.name || '');

  // Link to the contact's instructor profile; '' when they aren't an instructor.
  readonly contactLink = computed(() => {
    const instructorId = this.firstContact()?.instructorId;
    if (!instructorId) return '';
    const prefix = this.instructorLinkPrefix();
    if (prefix) {
      return `${prefix}${encodeURIComponent(instructorId)}`;
    }
    return `/instructors/${encodeURIComponent(instructorId)}`;
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
