/* instructor-view.ts
 *
 * Public page showing a single instructor's profile: cover image, profile
 * picture, name, level, location, contact details, a markdown self-description,
 * and the forthcoming events they are organising / managing / instructing at.
 *
 * The instructor is identified by the human-readable `instructorId` from the
 * route. Profile data comes from the public /instructors collection (loaded by
 * FindInstructorsService, with a direct Firestore fallback for deep links);
 * upcoming events are fetched on demand from DataManagerService.
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
  firestoreDocToInstructorPublicData,
} from '../../../functions/src/data-model';
import { collection, getDocs, getFirestore, query, where, limit } from 'firebase/firestore';
import { FIREBASE_APP, AppPathPatterns, Views } from '../app.config';
import { FindInstructorsService } from '../find-instructors.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { MarkdownViewer } from '../markdown-editor/markdown-viewer';
import { EventItemComponent } from '../events-calendar/event-item/event-item';

@Component({
  selector: 'app-instructor-view',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, MarkdownViewer, EventItemComponent],
  templateUrl: './instructor-view.html',
  styleUrl: './instructor-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstructorViewComponent implements OnInit {
  private findInstructorsService = inject(FindInstructorsService);
  private dataService = inject(DataManagerService);
  private firebaseApp = inject(FIREBASE_APP);
  private db = getFirestore(this.firebaseApp);
  routingService = inject(RoutingService<AppPathPatterns>);

  // Human-readable instructor ID from the route.
  instructorId = input.required<string>();
  titleLoaded = output<string>();

  instructor = signal<InstructorPublicData | null>(null);
  isLoading = signal(true);
  errorMessage = signal<string | null>(null);

  upcomingEvents = signal<IlcEvent[]>([]);
  eventsLoading = signal(false);

  schools = signal<School[]>([]);
  schoolsLoading = signal(false);

  backHref = computed(() => this.routingService.hrefForView(Views.FindAnInstructor, {}));

  // Link to the events search page, pre-filtered to this instructor.
  allEventsHref = computed(() => {
    const i = this.instructor();
    if (!i) return '';
    return `/events?instructorId=${encodeURIComponent(i.instructorId)}`;
  });

  // A short location summary line (region/city, county/state, country).
  locationLine = computed(() => {
    const i = this.instructor();
    if (!i) return '';
    return [i.publicRegionOrCity, i.publicCountyOrState, i.country]
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

  eventHref(ev: IlcEvent): string {
    return this.routingService.hrefForView(Views.EventView, { eventId: ev.docId });
  }

  ngOnInit() {
    window.scrollTo(0, 0);
    this.loadInstructor();
  }

  private async loadInstructor() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    const id = this.instructorId();
    try {
      let instructor = this.findInstructorsService.instructors.get(id) ?? null;
      if (!instructor) {
        // Fallback: direct query for deep links before the public set loads.
        const q = query(
          collection(this.db, 'instructors'),
          where('instructorId', '==', id),
          limit(1),
        );
        const snap = await getDocs(q);
        if (!snap.empty) {
          instructor = firestoreDocToInstructorPublicData(snap.docs[0]);
        }
      }

      if (instructor) {
        this.instructor.set(instructor);
        this.titleLoaded.emit(instructor.name);
        this.loadUpcomingEvents(instructor);
        this.loadSchools(instructor);
      } else {
        this.errorMessage.set('Instructor not found.');
        this.titleLoaded.emit('Instructor Not Found');
      }
    } catch (error) {
      console.error('Error loading instructor:', error);
      this.errorMessage.set('Failed to load instructor profile.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadUpcomingEvents(instructor: InstructorPublicData) {
    this.eventsLoading.set(true);
    try {
      const events = await this.dataService.getUpcomingEventsForInstructor(
        instructor.instructorId,
        instructor.docId,
      );
      this.upcomingEvents.set(events);
    } finally {
      this.eventsLoading.set(false);
    }
  }

  private async loadSchools(instructor: InstructorPublicData) {
    if (!instructor.instructorId) return;
    this.schoolsLoading.set(true);
    try {
      const schools = await this.dataService.getSchoolsForInstructor(instructor.instructorId);
      this.schools.set(schools);
    } finally {
      this.schoolsLoading.set(false);
    }
  }

  // A short location summary line for a school.
  schoolLocation(school: School): string {
    return [school.schoolCity, school.schoolCountyOrState, school.schoolCountry]
      .filter((p) => !!p)
      .join(', ');
  }

  schoolHref(school: School): string {
    return this.routingService.hrefForView(Views.SchoolView, { schoolId: school.schoolId });
  }
}
