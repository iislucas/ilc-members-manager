import {
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Grading, GradingStatus, getPrettyGradingStatus, initGrading } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { GradingRowHeaderComponent } from '../grading-row-header/grading-row-header';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

@Component({
  selector: 'app-grading-list',
  standalone: true,
  imports: [GradingEditComponent, GradingRowHeaderComponent, IconComponent, SpinnerComponent, FormsModule],
  templateUrl: './grading-list.html',
  styleUrl: './grading-list.scss',
})
export class GradingListComponent {
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

  limit = signal(50);

  instructorOptions = computed(() => {
    return this.dataService.instructors.entries().slice().sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  });

  hasActiveFilters = computed(() =>
    !!this.filterFromDate() || !!this.filterToDate() ||
    !!this.filterInstructorId() || !!this.filterStatus()
  );

  filteredByTab = computed(() => {
    const all = this.gradingSet().search(this.searchTerm());
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

    if (from) {
      results = results.filter(g => g.gradingEventDate >= from);
    }
    if (to) {
      results = results.filter(g => g.gradingEventDate && g.gradingEventDate <= to);
    }
    if (instructorId) {
      results = results.filter(g => g.gradingInstructorId === instructorId);
    }
    if (status) {
      results = results.filter(g => g.status === status);
    }
    return results;
  });

  gradings = computed(() => {
    return this.filteredByAdvanced().slice(0, this.limit());
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

  clearFilters() {
    this.filterFromDate.set('');
    this.filterToDate.set('');
    this.filterInstructorId.set('');
    this.filterStatus.set('');
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
