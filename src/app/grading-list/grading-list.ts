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

  gradingSet = input.required<SearchableSet<'id', Grading>>();

  private searchTerm = signal('');
  isAddingGrading = signal(false);
  newGrading = signal<Grading>(initGrading());

  limit = signal(50);
  gradings = computed(() => {
    const all = this.gradingSet().search(this.searchTerm());
    return all.slice(0, this.limit());
  });
  totalGradings = computed(
    () => this.gradingSet().search(this.searchTerm()).length,
  );

  loading = computed(() => this.gradingSet().loading());
  error = computed(() => this.gradingSet().error());

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
