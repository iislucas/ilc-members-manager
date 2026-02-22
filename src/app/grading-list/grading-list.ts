import {
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Grading, initGrading } from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { GradingEditComponent } from '../grading-edit/grading-edit';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-grading-list',
  standalone: true,
  imports: [GradingEditComponent, IconComponent, SpinnerComponent],
  templateUrl: './grading-list.html',
  styleUrl: './grading-list.scss',
})
export class GradingListComponent {
  firebaseStateService = inject(FirebaseStateService);
  user = this.firebaseStateService.user;
  canMakeNewGradings = computed(() => {
    const user = this.user();
    if (!user) return false;
    return user.isAdmin;
  });

  viewMode = input<'all' | 'instructor'>('all');
  activeTab = signal<'examined' | 'students' | 'mine'>('examined');

  gradingSet = input.required<SearchableSet<'id', Grading>>();
  myPersonalGradingSet = input<SearchableSet<'id', Grading>>();

  private searchTerm = signal('');
  isAddingGrading = signal(false);
  newGrading = signal<Grading>(initGrading());

  limit = signal(50);

  filteredByTab = computed(() => {
    if (this.viewMode() === 'instructor' && this.activeTab() === 'mine') {
      const myPersonalSet = this.myPersonalGradingSet();
      if (!myPersonalSet) return [];
      return myPersonalSet.search(this.searchTerm());
    }

    const all = this.gradingSet().search(this.searchTerm());
    if (this.viewMode() !== 'instructor') return all;

    const user = this.user();
    if (!user || !user.member.instructorId) return all;

    const myInstructorId = user.member.instructorId;
    return all.filter(g => {
      const isAssessor = g.gradingInstructorId === myInstructorId || g.assistantInstructorIds.includes(myInstructorId);
      if (this.activeTab() === 'examined') {
        return isAssessor;
      } else {
        return !isAssessor;
      }
    });
  });

  gradings = computed(() => {
    return this.filteredByTab().slice(0, this.limit());
  });
  totalGradings = computed(
    () => this.filteredByTab().length,
  );

  loading = computed(() => {
    if (this.viewMode() === 'instructor' && this.activeTab() === 'mine') {
      const p = this.myPersonalGradingSet();
      if (p) return p.loading();
    }
    return this.gradingSet().loading();
  });
  error = computed(() => {
    if (this.viewMode() === 'instructor' && this.activeTab() === 'mine') {
      const p = this.myPersonalGradingSet();
      if (p) return p.error();
    }
    return this.gradingSet().error();
  });

  setActiveTab(tab: 'examined' | 'students' | 'mine') {
    this.activeTab.set(tab);
    this.limit.set(50);
  }

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

  onNewGrading() {
    const grading = initGrading();
    grading.gradingPurchaseDate = new Date().toISOString().split('T')[0];
    this.newGrading.set(grading);
    this.isAddingGrading.set(true);
  }

  onNewGradingClose() {
    this.isAddingGrading.set(false);
  }
}
