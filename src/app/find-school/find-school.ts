import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { DataManagerService } from '../data-manager.service';
import { School } from '../../../functions/src/data-model';

@Component({
  selector: 'app-find-school',
  standalone: true,
  imports: [
    FormsModule,
    CommonModule,
    IconComponent,
    SpinnerComponent,
  ],
  templateUrl: './find-school.html',
  styleUrl: './find-school.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class FindSchoolComponent {
  dataManager = inject(DataManagerService);
  searchTerm = signal('');

  filteredSchools = computed(() => {
    return this.dataManager.schools.search(this.searchTerm());
  });
}
