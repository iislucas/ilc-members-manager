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
import { InstructorCardComponent } from '../instructor-card/instructor-card';
import { FindInstructorsService } from '../find-instructors.service';

@Component({
  selector: 'app-find-an-instructor',
  standalone: true,
  imports: [FormsModule, CommonModule, IconComponent, InstructorCardComponent],
  templateUrl: './find-an-instructor.html',
  styleUrl: './find-an-instructor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class FindAnInstructorComponent {
  private findInstructorsService = inject(FindInstructorsService);
  searchTerm = signal('');

  filteredInstructors = computed(() => {
    return this.findInstructorsService.instructors.search(this.searchTerm());
  });
}
