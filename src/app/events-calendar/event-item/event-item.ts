import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  IlcEvent,
  InstructorPublicData,
  firestoreDocToInstructorPublicData,
} from '../../../../functions/src/data-model';
import { IconComponent } from '../../icons/icon.component';
import { formatDateRange } from '../format-date-range';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP } from '../../app.config';
import { collection, getFirestore, query, where, getDocs } from 'firebase/firestore';


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
  private firebaseApp = inject(FIREBASE_APP);

  event = input.required<IlcEvent>();
  readonly dateDisplay = computed(() => formatDateRange(this.event().start, this.event().end));

  // Optional prefix for instructor profile links. When empty (default),
  // the component uses the in-app hash route. When set (e.g. by the
  // standalone WC), links point to the specified base URL.
  instructorLinkPrefix = input<string>('');

  // Instructor data fetched directly from Firestore when DataManagerService
  // doesn't have it (e.g. in the standalone WC where auth isn't available).
  private directInstructor = signal<InstructorPublicData | null>(null);

  constructor() {
    // When the leading instructor ID changes, attempt a direct Firestore
    // lookup if the DataManagerService doesn't have the instructor data.
    effect(() => {
      const id = this.event().leadingInstructorId;
      if (!id) return;
      const cached = this.dataService.instructors.get(id);
      if (cached) return; // already available from DataManagerService
      this.fetchInstructorDirect(id);
    });
  }

  // Resolve the leading instructor to a display label: "Name (InstructorId)".
  readonly instructorLabel = computed(() => {
    const id = this.event().leadingInstructorId;
    if (!id) return '';
    // Try DataManagerService first (available when logged in).
    const cached = this.dataService.instructors.get(id);
    if (cached) {
      return `${cached.name} (${id})`;
    }
    // Fall back to direct Firestore result (standalone WC).
    const direct = this.directInstructor();
    if (direct && direct.instructorId === id) {
      return `${direct.name} (${id})`;
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

  // Fetch an instructor directly from the public /instructors collection,
  // querying by instructorId. Used when DataManagerService data isn't available.
  private async fetchInstructorDirect(instructorId: string): Promise<void> {
    try {
      const db = getFirestore(this.firebaseApp);
      const q = query(
        collection(db, 'instructors'),
        where('instructorId', '==', instructorId),
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const instructor = firestoreDocToInstructorPublicData(snap.docs[0]);
        this.directInstructor.set(instructor);
      }
    } catch (error) {
      console.warn('Could not fetch instructor data directly:', error);
    }
  }
}
