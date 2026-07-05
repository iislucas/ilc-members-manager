import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Grading, GradingStatus, IlcEvent, getPrettyGradingStatus, initGrading, gradingManagerIdsOf, isGradingPaid } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { MemberSelectorComponent } from '../member-selector/member-selector';
import { InstructorSelectorComponent } from '../instructor-selector/instructor-selector';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService, EventSearchCriteriaDateRange } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

export enum GradingSortField {
  EventDate = 'eventDate',
  PurchaseDate = 'purchaseDate',
  LastUpdated = 'lastUpdated',
  Student = 'student',
  Level = 'level',
  Status = 'status',
}

export enum SortDirection {
  Asc = 'asc',
  Desc = 'desc',
}

export const GRADING_SORT_FIELD_LABELS: { value: GradingSortField; label: string }[] = [
  { value: GradingSortField.EventDate, label: 'Event Date' },
  { value: GradingSortField.PurchaseDate, label: 'Purchase Date' },
  { value: GradingSortField.LastUpdated, label: 'Last Updated' },
  { value: GradingSortField.Student, label: 'Student' },
  { value: GradingSortField.Level, label: 'Level' },
  { value: GradingSortField.Status, label: 'Status' },
];

// A set of gradings that all share the same linked event (same
// `gradingEventDocId`), gathered under one heading even when the individual
// gradings happened on different days.
export interface GradingEventGroup {
  eventDocId: string;
  title: string; // Display title from the denormalized `gradingEvent` snapshot.
  date: string; // Earliest event date among the gradings (shown in the heading).
  endDate: string; // Latest event date; anchors the event in the date timeline.
  gradings: Grading[]; // Possibly truncated for display; see `total`.
  total: number; // Full count of gradings in the group, before any limit.
}

// A set of gradings not linked to any event that nonetheless share the same
// grading date and primary grading instructor. These read as an "implicit event"
// — a de-facto grading day run by one instructor — even though no `IlcEvent`
// record ties them together.
export interface GradingDateInstructorGroup {
  key: string; // `${date}|${instructorId}`.
  date: string; // Shared `gradingEventDate` (YYYY-MM-DD).
  instructorId: string; // Shared primary `gradingInstructorId`.
  instructorName: string; // Resolved display name for the heading.
  gradings: Grading[]; // Possibly truncated for display; see `total`.
  total: number; // Full count in the group, before any display limit.
}

// One row in the grouped grading list: a single grading not linked to an event,
// an event block (heading + its gradings), or an "implicit event" block grouping
// unlinked gradings by shared date + instructor. All are positioned on the same
// date timeline so unlinked gradings and blocks interleave chronologically.
export type GradingListItem =
  | { kind: 'grading'; key: string; grading: Grading }
  | { kind: 'event'; key: string; group: GradingEventGroup }
  | { kind: 'implicit'; key: string; group: GradingDateInstructorGroup };

function compareGradingsByField(a: Grading, b: Grading, field: GradingSortField, dir: SortDirection): number {
  const mul = dir === SortDirection.Asc ? 1 : -1;
  switch (field) {
    case GradingSortField.EventDate:
      return mul * (a.gradingEventDate || '').localeCompare(b.gradingEventDate || '');
    case GradingSortField.PurchaseDate:
      return mul * (a.gradingPurchaseDate || '').localeCompare(b.gradingPurchaseDate || '');
    case GradingSortField.LastUpdated:
      return mul * (a.lastUpdated || '').localeCompare(b.lastUpdated || '');
    case GradingSortField.Student:
      return mul * (a.studentMemberId || '').localeCompare(b.studentMemberId || '', undefined, { numeric: true });
    case GradingSortField.Level:
      return mul * (a.level || '').localeCompare(b.level || '');
    case GradingSortField.Status:
      return mul * (a.status || '').localeCompare(b.status || '');
    default:
      return 0;
  }
}

@Component({
  selector: 'app-grading-list',
  standalone: true,
  imports: [GradingEditComponent, GradingRowHeaderComponent, IconComponent, SpinnerComponent, AutocompleteComponent, MemberSelectorComponent, InstructorSelectorComponent, FormsModule],
  templateUrl: './grading-list.html',
  styleUrl: './grading-list.scss',
})
export class GradingListComponent {
  readonly sortFieldOptions = GRADING_SORT_FIELD_LABELS;
  GradingSortField = GradingSortField;
  SortDirection = SortDirection;
  firebaseStateService = inject(FirebaseStateService);
  private dataService = inject(DataManagerService);
  private routingService: RoutingService<AppPathPatterns> = inject(RoutingService);
  user = this.firebaseStateService.user;
  // Only admins, and only on the "Manage Gradings" page (viewMode 'all'), can
  // create a grading directly. The member-facing "My Gradings" lists (viewMode
  // 'member'/'instructor') use the request flow instead.
  canMakeNewGradings = computed(() => {
    const user = this.user();
    if (!user) return false;
    return user.isAdmin && this.viewMode() === 'all';
  });

  viewMode = input<'all' | 'instructor' | 'member'>('all');
  instructorTab = input<'examined' | 'students' | 'mine'>('examined');

  gradingSet = input.required<SearchableSet<'docId', Grading>>();

  // A search-only mirror of `gradingSet` whose entries carry extra fields with
  // the resolved student and instructor display *names* (looked up live from the
  // members/instructors caches, plus all examiner names) so MiniSearch can match
  // on them. These fields use distinct names (`studentSearchText` /
  // `instructorSearchText`) so they don't clobber the grading's own
  // `studentName` / `gradingInstructorName` snapshot fields — the enriched
  // entries are also what gets rendered by the row header, which re-derives the
  // display name from those snapshots.
  private searchSet = new SearchableSet<'docId', Grading & { studentSearchText: string; instructorSearchText: string }>(
    [],
    'docId',
  );

  // Keep `searchSet` in sync with the source gradings and the member/instructor
  // name caches. Runs whenever the gradings load or a referenced name resolves;
  // not per keystroke (the search term is read in `filteredByTab` instead).
  private _syncSearchSet = effect(() => {
    const source = this.gradingSet();
    this.searchSet.fieldsToSearch = [...source.fieldsToSearch, 'studentSearchText', 'instructorSearchText'];
    this.searchSet.setEntries(
      source.uniqueEntries().map((g) => ({
        ...g,
        studentSearchText: this.dataService.memberDisplayName(
          g.studentMemberDocId,
          g.studentMemberId,
          g.studentName,
        ),
        // Include the senior grading instructor plus any grading managers
        // so searching for any examiner's name surfaces the grading. The primary
        // instructor's cached name is supplied as a fallback for non-admin views.
        instructorSearchText: [g.gradingInstructorId, ...gradingManagerIdsOf(g)]
          .map((id) =>
            this.dataService.instructorDisplayName(
              id,
              id === g.gradingInstructorId ? g.gradingInstructorName : undefined,
            ),
          )
          .filter((name) => !!name)
          .join(' '),
      })),
    );
  });

  GradingStatus = GradingStatus;
  getPrettyGradingStatus = getPrettyGradingStatus;
  readonly gradingStatuses = Object.values(GradingStatus);

  private searchTerm = signal('');
  isAddingGrading = signal(false);
  newGrading = signal<Grading>(initGrading());
  showAdvancedSearch = signal(false);

  filterFromDate = signal('');
  filterToDate = signal('');
  filterInstructorId = signal('');
  filterStatus = signal('');
  filterStudentMemberId = signal('');
  // Show only gradings that have been accepted/completed but are not yet paid.
  filterUnpaidOnly = signal(false);

  // The selected event filter lives in the URL `event` param so a filtered view
  // (e.g. all gradings at one event) is shareable. Both grading routes
  // (ManageGradings / MemberGradings) carry the param; we proxy to whichever
  // route matched. Reads go through `filterEventDocId`; writes through
  // `setFilterEventDocId`.
  private eventFilterParam = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MemberGradings) {
      return this.routingService.signals[Views.MemberGradings].urlParams.event;
    }
    return this.routingService.signals[Views.ManageGradings].urlParams.event;
  });
  filterEventDocId = computed(() => this.eventFilterParam()());
  private setFilterEventDocId(docId: string) {
    this.eventFilterParam().set(docId);
  }

  // The "implicit event" selection (a grading date + primary instructor) lives in
  // the URL `groupDate`/`groupInstructor` params, mirroring the event filter, so a
  // filtered implicit-event view is shareable. Reads go through
  // `filterGroupDate`/`filterGroupInstructor`; writes through `setGroupFilter`.
  private groupDateParam = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MemberGradings) {
      return this.routingService.signals[Views.MemberGradings].urlParams.groupDate;
    }
    return this.routingService.signals[Views.ManageGradings].urlParams.groupDate;
  });
  private groupInstructorParam = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (match === Views.MemberGradings) {
      return this.routingService.signals[Views.MemberGradings].urlParams.groupInstructor;
    }
    return this.routingService.signals[Views.ManageGradings].urlParams.groupInstructor;
  });
  filterGroupDate = computed(() => this.groupDateParam()());
  filterGroupInstructor = computed(() => this.groupInstructorParam()());
  private setGroupFilter(date: string, instructorId: string) {
    this.groupDateParam().set(date);
    this.groupInstructorParam().set(instructorId);
  }

  sortField = signal<GradingSortField>(GradingSortField.LastUpdated);
  sortDirection = signal<SortDirection>(SortDirection.Desc);

  limit = signal(50);

  // Events are loaded on demand (recent first) to power the event autocomplete
  // filter. The grading itself only stores the linked event's doc ID.
  eventsSet = new SearchableSet<'docId', IlcEvent>(['title', 'location', 'start'], 'docId');

  _loadEvents = effect(() => {
    if (!this.showAdvancedSearch()) return;
    if (this.eventsSet.entries().length > 0) return;
    const criteria: EventSearchCriteriaDateRange = { kind: 'date' };
    this.dataService.searchEvents(criteria).then((events) => {
      this.eventsSet.setEntries(events);
    });
  });

  eventDisplayFns = {
    toChipId: (e: IlcEvent) => e.docId,
    toName: (e: IlcEvent) => `${e.start.substring(0, 10)} — ${e.title}`,
  };

  // Display name for the currently selected event filter (or '' if none).
  selectedEventName = computed(() => {
    const docId = this.filterEventDocId();
    if (!docId) return '';
    const event = this.eventsSet.get(docId);
    return event ? this.eventDisplayFns.toName(event) : '';
  });

  // A group (implicit-event) selection is active only when both params are set.
  hasGroupFilter = computed(() => !!this.filterGroupDate() && !!this.filterGroupInstructor());

  hasActiveFilters = computed(() =>
    !!this.filterFromDate() || !!this.filterToDate() ||
    !!this.filterInstructorId() || !!this.filterStatus() ||
    !!this.filterStudentMemberId() || !!this.filterEventDocId() ||
    this.hasGroupFilter() || this.filterUnpaidOnly()
  );

  filteredByTab = computed<Grading[]>(() => {
    const all = this.searchSet.search(this.searchTerm());
    if (this.viewMode() !== 'instructor') return all;

    const user = this.user();
    if (!user || !user.member.instructorId) return all;

    const myInstructorId = user.member.instructorId;
    return all.filter(g => {
      const isAssessor = g.gradingInstructorId === myInstructorId || gradingManagerIdsOf(g).includes(myInstructorId);
      if (this.instructorTab() === 'examined') {
        return isAssessor;
      } else {
        return !isAssessor;
      }
    });
  });

  filteredByAdvanced = computed(() => {
    let results = this.filteredByTab();
    const from = this.filterFromDate();
    const to = this.filterToDate();
    const instructorId = this.filterInstructorId();
    const status = this.filterStatus();
    const studentMemberId = this.filterStudentMemberId();
    const eventDocId = this.filterEventDocId();

    if (from) {
      results = results.filter(g => g.gradingEventDate >= from);
    }
    if (to) {
      results = results.filter(g => g.gradingEventDate && g.gradingEventDate <= to);
    }
    if (instructorId) {
      // Match if the selected instructor is the grading (senior) instructor or
      // one of the grading managers.
      results = results.filter(g =>
        g.gradingInstructorId === instructorId ||
        gradingManagerIdsOf(g).includes(instructorId),
      );
    }
    if (status) {
      results = results.filter(g => g.status === status);
    }
    if (studentMemberId) {
      results = results.filter(g => g.studentMemberId === studentMemberId);
    }
    if (eventDocId) {
      results = results.filter(g => g.gradingEventDocId === eventDocId);
    }
    // An implicit-event selection narrows to the unlinked gradings sharing that
    // exact date + primary instructor.
    if (this.hasGroupFilter()) {
      const groupDate = this.filterGroupDate();
      const groupInstructor = this.filterGroupInstructor();
      results = results.filter(
        (g) =>
          !g.gradingEventDocId &&
          g.gradingEventDate === groupDate &&
          g.gradingInstructorId === groupInstructor,
      );
    }
    if (this.filterUnpaidOnly()) {
      results = results.filter((g) => !isGradingPaid(g));
    }
    return results;
  });

  sortedGradings = computed(() => {
    const all = this.filteredByAdvanced();
    const field = this.sortField();
    const dir = this.sortDirection();
    return [...all].sort((a, b) => compareGradingsByField(a, b, field, dir));
  });

  gradings = computed(() => {
    return this.sortedGradings().slice(0, this.limit());
  });
  totalGradings = computed(
    () => this.filteredByAdvanced().length,
  );

  // Group the gradings by linked event in the admin ("all") and instructor
  // views so all gradings conducted at one event are listed together under an
  // event heading. The member's own gradings keep the flat list.
  groupByEvent = computed(() => {
    const mode = this.viewMode();
    return mode === 'all' || mode === 'instructor';
  });

  // Build the grouped timeline from the filtered set: gather every grading
  // sharing a `gradingEventDocId` into an event block (ordered within by the
  // chosen sort field), then interleave those blocks with the unlinked gradings
  // on a single date timeline. An event block is anchored at its last event day
  // (its latest `gradingEventDate`), so — in the default newest-first order —
  // gradings dated after the event sit above it, and gradings concurrent with
  // or before its last day sit below it.
  listItems = computed<GradingListItem[]>(() => {
    if (!this.groupByEvent()) return [];
    const all = this.filteredByAdvanced();
    const field = this.sortField();
    const dir = this.sortDirection();
    const mul = dir === SortDirection.Asc ? 1 : -1;

    const byEvent = new Map<string, Grading[]>();
    // Unlinked gradings bucketed by `${gradingEventDate}|${gradingInstructorId}` so
    // those sharing a grading day and instructor form an implicit-event group.
    const byDateInstructor = new Map<string, Grading[]>();
    const standalone: Grading[] = [];
    for (const g of all) {
      if (g.gradingEventDocId) {
        const list = byEvent.get(g.gradingEventDocId) ?? [];
        list.push(g);
        byEvent.set(g.gradingEventDocId, list);
      } else if (g.gradingEventDate && g.gradingInstructorId) {
        const key = `${g.gradingEventDate}|${g.gradingInstructorId}`;
        const list = byDateInstructor.get(key) ?? [];
        list.push(g);
        byDateInstructor.set(key, list);
      } else {
        standalone.push(g);
      }
    }

    // Each entry carries the date that positions it on the timeline.
    type Positioned = { item: GradingListItem; date: string; isEvent: boolean };
    const positioned: Positioned[] = [];

    for (const [eventDocId, gs] of byEvent) {
      const sorted = [...gs].sort((a, b) => compareGradingsByField(a, b, field, dir));
      const dates = gs.map((g) => g.gradingEventDate).filter((d) => !!d).sort();
      const date = dates[0] ?? '';
      const endDate = dates[dates.length - 1] ?? '';
      const title = gs.find((g) => g.gradingEvent)?.gradingEvent ?? '';
      const group: GradingEventGroup = {
        eventDocId, title, date, endDate, gradings: sorted, total: sorted.length,
      };
      positioned.push({ item: { kind: 'event', key: `event:${eventDocId}`, group }, date: endDate, isEvent: true });
    }
    // A bucket of 2+ becomes an implicit-event block; a lone grading stays a plain
    // row so single unlinked gradings aren't wrapped in a spurious heading.
    for (const [key, gs] of byDateInstructor) {
      if (gs.length < 2) {
        standalone.push(gs[0]);
        continue;
      }
      const sorted = [...gs].sort((a, b) => compareGradingsByField(a, b, field, dir));
      const [date, instructorId] = [gs[0].gradingEventDate, gs[0].gradingInstructorId];
      const instructorName = this.dataService.instructorDisplayName(
        instructorId,
        gs.find((g) => g.gradingInstructorName)?.gradingInstructorName,
      );
      const group: GradingDateInstructorGroup = {
        key, date, instructorId, instructorName, gradings: sorted, total: sorted.length,
      };
      positioned.push({ item: { kind: 'implicit', key: `implicit:${key}`, group }, date, isEvent: true });
    }
    for (const g of standalone) {
      const date = g.gradingEventDate || g.gradingPurchaseDate || '';
      positioned.push({ item: { kind: 'grading', key: `grading:${g.docId}`, grading: g }, date, isEvent: false });
    }

    positioned.sort((a, b) => {
      const cmp = (a.date || '').localeCompare(b.date || '');
      if (cmp !== 0) return mul * cmp;
      // Same anchor date: treat an event as occurring at the end of its last
      // day, so a standalone grading on that day reads as concurrent/earlier
      // and sits below the event block in the default newest-first order.
      if (a.isEvent !== b.isEvent) return mul * (a.isEvent ? 1 : -1);
      return 0;
    });

    return positioned.map((p) => p.item);
  });

  // Apply the display limit across the timeline, counting each standalone
  // grading and each grading inside an event block, keeping headings intact.
  limitedItems = computed<GradingListItem[]>(() => {
    let remaining = this.limit();
    const out: GradingListItem[] = [];
    for (const item of this.listItems()) {
      if (remaining <= 0) break;
      if (item.kind === 'grading') {
        out.push(item);
        remaining -= 1;
      } else {
        const slice = item.group.gradings.slice(0, remaining);
        remaining -= slice.length;
        out.push({ ...item, group: { ...item.group, gradings: slice } } as GradingListItem);
      }
    }
    return out;
  });

  loading = computed(() => {
    return this.gradingSet().loading();
  });
  error = computed(() => {
    return this.gradingSet().error();
  });

  isStudentGrading(grading: Grading): boolean {
    const user = this.user();
    if (!user || !user.member.instructorId) return false;
    const myInstructorId = user.member.instructorId;
    return grading.gradingInstructorId !== myInstructorId &&
      !gradingManagerIdsOf(grading).includes(myInstructorId);
  }

  // "Show more" behaviour. In the admin view only the most recent page of
  // gradings is subscribed, so pull the next page from Firestore and grow the
  // display window in step. Other views have their whole set loaded already, so
  // just lift the display limit.
  onShowMore() {
    if (this.viewMode() === 'all') {
      this.dataService.loadMoreGradings();
      this.limit.update((n) => (n === Infinity ? n : n + 50));
    } else {
      this.limit.set(Infinity);
    }
  }

  onSearch(event: Event) {
    this.searchTerm.set((event.target as HTMLInputElement).value);
    this.limit.set(50);
  }

  toggleAdvancedSearch() {
    this.showAdvancedSearch.update(v => !v);
  }

  toggleSortDirection() {
    this.sortDirection.update(d =>
      d === SortDirection.Asc ? SortDirection.Desc : SortDirection.Asc,
    );
  }

  onInstructorFilterChange(instructorId: string) {
    this.filterInstructorId.set(instructorId);
    this.limit.set(50);
  }

  onStudentFilterChange(memberId: string) {
    this.filterStudentMemberId.set(memberId);
    this.limit.set(50);
  }

  onEventFilterSelected(event: IlcEvent) {
    this.setFilterEventDocId(event.docId);
    this.limit.set(50);
  }

  // Clicking an event heading in grouped mode filters the list down to that
  // single event's gradings.
  onEventGroupClick(group: GradingEventGroup) {
    if (!group.eventDocId) return;
    this.setFilterEventDocId(group.eventDocId);
    this.limit.set(50);
  }

  clearEventFilter() {
    this.setFilterEventDocId('');
    this.limit.set(50);
  }

  // Clicking an implicit-event heading filters the list to that date + instructor.
  // Because the admin list is paginated (only the most recent gradings are
  // loaded), first fetch the full set for that date/instructor from Firestore and
  // merge it in, so a group at the bottom of the loaded window shows every member.
  onImplicitGroupClick(group: GradingDateInstructorGroup) {
    this.setGroupFilter(group.date, group.instructorId);
    this.limit.set(50);

    const opts = this.viewMode() === 'instructor'
      ? { instructorMemberDocId: this.user()?.member.docId }
      : undefined;
    this.dataService
      .searchGradingsByDateAndInstructor(group.date, group.instructorId, opts)
      .then((gradings) => {
        for (const g of gradings) {
          this.gradingSet().upsert(g);
        }
      })
      .catch((err) => console.error('Failed to load implicit-event gradings:', err));
  }

  clearGroupFilter() {
    this.setGroupFilter('', '');
    this.limit.set(50);
  }

  onEventFilterText(text: string) {
    if (!text) {
      this.setFilterEventDocId('');
      this.limit.set(50);
    }
  }

  clearFilters() {
    this.filterFromDate.set('');
    this.filterToDate.set('');
    this.filterInstructorId.set('');
    this.filterStatus.set('');
    this.filterStudentMemberId.set('');
    this.setFilterEventDocId('');
    this.setGroupFilter('', '');
    this.filterUnpaidOnly.set(false);
    this.limit.set(50);
  }

  onNewGrading() {
    const grading = initGrading();
    grading.gradingPurchaseDate = new Date().toISOString().split('T')[0];
    this.newGrading.set(grading);
    this.isAddingGrading.set(true);
  }

  onNewGradingClose() {
    this.isAddingGrading.set(false);
  }

  gradingLink(grading: Grading): string {
    const href = this.routingService.hrefForView(Views.GradingView, {
      gradingId: grading.docId,
    });
    // Gradings opened from the member-facing "My Gradings" page (any of its
    // tabs — viewMode 'member' or 'instructor') should navigate back to My
    // Gradings, so tag the link with its origin. The admin "Manage Gradings"
    // list (viewMode 'all') is left untagged and goes back there.
    if (this.viewMode() === 'member' || this.viewMode() === 'instructor') {
      const sep = href.includes('?') ? '&' : '?';
      return `${href}${sep}from=my-gradings`;
    }
    return href;
  }
}
