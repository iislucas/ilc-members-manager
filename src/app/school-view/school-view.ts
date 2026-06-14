/* school-view.ts
 *
 * Public page showing a single school's profile: cover image, profile picture /
 * logo, name, location, contact details, a markdown description, and the
 * school's owner and managers (linking to their instructor profile pages).
 *
 * The school is identified by the human-readable `schoolId` from the route.
 * Profile data comes from the public /schools collection (loaded by
 * DataManagerService, with a direct Firestore fallback for deep links).
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {
  IlcEvent,
  InstructorPublicData,
  School,
  firestoreDocToSchool,
} from '../../../functions/src/data-model';
import { collection, getDocs, getFirestore, query, where, limit } from 'firebase/firestore';
import { FIREBASE_APP, AppPathPatterns, Views } from '../app.config';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownViewer } from '../markdown-editor/markdown-viewer';
import { EventItemComponent } from '../events-calendar/event-item/event-item';

@Component({
  selector: 'app-school-view',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, MarkdownViewer, EventItemComponent],
  templateUrl: './school-view.html',
  styleUrl: './school-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SchoolViewComponent implements OnInit {
  private dataService = inject(DataManagerService);
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  routingService = inject(RoutingService<AppPathPatterns>);

  // Human-readable school ID from the route.
  schoolId = input.required<string>();
  titleLoaded = output<string>();

  school = signal<School | null>(null);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);

  upcomingEvents = signal<IlcEvent[]>([]);
  pastEvents = signal<IlcEvent[]>([]);
  pastEventsTotal = signal(0);
  eventsLoading = signal(false);

  backHref = computed(() => this.routingService.hrefForView(Views.FindSchool, {}));

  // Link to the events search page, pre-filtered to this school.
  allEventsHref = computed(() => {
    const s = this.school();
    if (!s) return '';
    return `#/events?schoolId=${encodeURIComponent(s.schoolId)}`;
  });

  eventHref(ev: IlcEvent): string {
    return this.routingService.hrefForView(Views.EventView, { eventId: ev.docId });
  }

  // The school's owner, resolved to their public instructor data (if available).
  owner = computed<InstructorPublicData | null>(() => {
    const s = this.school();
    if (!s || !s.ownerInstructorId) return null;
    return this.dataService.instructors.get(s.ownerInstructorId) ?? null;
  });

  // The school's managers, resolved to their public instructor data. Excludes
  // the owner (who is implicitly also a manager).
  managers = computed(() => {
    const s = this.school();
    if (!s) return [];
    return s.managerInstructorIds
      .filter((id) => id && id !== s.ownerInstructorId)
      .map((id) => ({
        instructorId: id,
        instructor: this.dataService.instructors.get(id) ?? null,
      }));
  });

  // A short location summary line (city, county/state, country).
  locationLine = computed(() => {
    const s = this.school();
    if (!s) return '';
    return [s.schoolCity, s.schoolCountyOrState, s.schoolCountry]
      .filter((p) => !!p)
      .join(', ');
  });

  mapsUrl = computed(() => {
    const line = this.locationLine();
    if (!line) return '';
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`;
  });

  ensureUrl(url: string): string {
    if (!url) return '';
    return url.startsWith('http') ? url : 'https://' + url;
  }

  stripUrlPrefix(url: string): string {
    return url.replace(/^https?:\/\//, '');
  }

  instructorHref(instructorId: string): string {
    return this.routingService.hrefForView(Views.InstructorView, { instructorId });
  }

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadSchool();
  }

  private async loadSchool() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    const id = this.schoolId();
    try {
      let school = this.dataService.schools.get(id) ?? null;
      if (!school) {
        // Fallback: direct query for deep links before the public set loads.
        const q = query(
          collection(this.db, 'schools'),
          where('schoolId', '==', id),
          limit(1),
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          school = firestoreDocToSchool(snap.docs[0]);
        }
      }

      if (school) {
        this.school.set(school);
        this.titleLoaded.emit(school.schoolName || school.schoolId || 'School');
        this.loadEvents(school);
      } else {
        this.errorMessage.set('School not found.');
        this.titleLoaded.emit('School Not Found');
      }
    } catch (error) {
      console.error('Error loading school:', error);
      this.errorMessage.set('Failed to load school profile.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadEvents(school: School) {
    if (!school.schoolId) return;
    this.eventsLoading.set(true);
    try {
      const { upcoming, past, pastTotal } = await this.dataService.getEventsForSchool(
        school.schoolId,
      );
      this.upcomingEvents.set(upcoming);
      this.pastEvents.set(past);
      this.pastEventsTotal.set(pastTotal);
    } finally {
      this.eventsLoading.set(false);
    }
  }
}
