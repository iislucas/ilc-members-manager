import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Grading, GradingStatus, IlcEvent, getPrettyGradingStatus, initGrading } from '../../../functions/src/data-model';
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
  canMakeNewGradings = computed(() => {
    const user = this.user();
    if (!user) return false;
    return user.isAdmin;
  });

  viewMode = input<'all' | 'instructor' | 'member'>('all');
  instructorTab = input<'examined' | 'students' | 'mine'>('examined');

  gradingSet = input.required<SearchableSet<'docId', Grading>>();

  // A search-only mirror of `gradingSet` whose entries are enriched with the
  // resolved student and instructor *names*, looked up from the already-loaded
  // members/instructors caches via the grading's docIds. The names are never
  // persisted to the Grading data model — they exist only on these in-memory
  // copies so MiniSearch can match on them.
  private searchSet = new SearchableSet<'docId', Grading & { studentName: string; instructorName: string }>(
    [],
    'docId',
  );

  // Keep `searchSet` in sync with the source gradings and the member/instructor
  // name caches. Runs whenever the gradings load or a referenced name resolves;
  // not per keystroke (the search term is read in `filteredByTab` instead).
  private _syncSearchSet = effect(() => {
    const source = this.gradingSet();
    this.searchSet.fieldsToSearch = [...source.fieldsToSearch, 'studentName', 'instructorName'];
    this.searchSet.setEntries(
      source.uniqueEntries().map((g) => ({
        ...g,
        studentName: this.dataService.memberDisplayName(
          g.studentMemberDocId,
          g.studentMemberId,
          g.studentName,
        ),
        // Include the senior grading instructor plus any assistant instructors
        // so searching for any examiner's name surfaces the grading. The primary
        // instructor's cached name is supplied as a fallback for non-admin views.
        instructorName: [g.gradingInstructorId, ...g.assistantInstructorIds]
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
  filterEventDocId = signal('');

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

  hasActiveFilters = computed(() =>
    !!this.filterFromDate() || !!this.filterToDate() ||
    !!this.filterInstructorId() || !!this.filterStatus() ||
    !!this.filterStudentMemberId() || !!this.filterEventDocId()
  );

  filteredByTab = computed<Grading[]>(() => {
    const all = this.searchSet.search(this.searchTerm());
    if (this.viewMode() !== 'instructor') return all;

    const user = this.user();
    if (!user || !user.member.instructorId) return all;

    const myInstructorId = user.member.instructorId;
    return all.filter(g => {
      const isAssessor = g.gradingInstructorId === myInstructorId || g.assistantInstructorIds.includes(myInstructorId);
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
      // one of the grading managers (assistant instructors).
      results = results.filter(g =>
        g.gradingInstructorId === instructorId ||
        g.assistantInstructorIds.includes(instructorId),
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
      !grading.assistantInstructorIds.includes(myInstructorId);
  }

  showAll() {
    this.limit.set(Infinity);
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
    this.filterEventDocId.set(event.docId);
    this.limit.set(50);
  }

  onEventFilterText(text: string) {
    if (!text) {
      this.filterEventDocId.set('');
      this.limit.set(50);
    }
  }

  clearFilters() {
    this.filterFromDate.set('');
    this.filterToDate.set('');
    this.filterInstructorId.set('');
    this.filterStatus.set('');
    this.filterStudentMemberId.set('');
    this.filterEventDocId.set('');
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
    return this.routingService.hrefForView(Views.GradingView, {
      gradingId: grading.docId,
    });
  }
}
