import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';
import { InstructorCardComponent } from '../instructor-card/instructor-card';

@Component({
  selector: 'app-find-an-instructor',
  standalone: true,
  imports: [FormsModule, CommonModule, IconComponent, InstructorCardComponent],
  templateUrl: './find-an-instructor.html',
  styleUrl: './find-an-instructor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindAnInstructorComponent {
  private membersService = inject(DataManagerService);
  searchTerm = signal('');

  filteredInstructors = computed(() => {
    return this.membersService.searchInstructors(this.searchTerm());
  });
}
