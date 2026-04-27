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
import { SpinnerComponent } from '../spinner/spinner.component';
import { RoutingService } from '../routing.service';
import { AppPathPatterns, Views } from '../app.config';

@Component({
  selector: 'app-find-an-instructor',
  standalone: true,
  imports: [
    FormsModule,
    CommonModule,
    IconComponent,
    InstructorCardComponent,
    SpinnerComponent,
  ],
  templateUrl: './find-an-instructor.html',
  styleUrl: './find-an-instructor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.ShadowDom,
})
export class FindAnInstructorComponent {
  findInstructorsService = inject(FindInstructorsService);
  routingService: RoutingService<AppPathPatterns> = inject(RoutingService<AppPathPatterns>);

  private viewSignals = this.routingService.signals[Views.FindAnInstructor];

  // Read the instructorId URL param for direct instructor lookup.
  instructorIdParam = computed(() => this.viewSignals.urlParams.instructorId());

  /** The resolved name of the filtered instructor, for display in the chip. */
  instructorFilterName = computed(() => {
    const id = this.instructorIdParam();
    if (!id) return '';
    const match = this.findInstructorsService.instructors.get(id);
    return match?.name || '';
  });

  clearInstructorFilter() {
    this.viewSignals.urlParams.instructorId.set('');
  }

  searchTerm = computed(() => this.viewSignals.urlParams.q());

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.viewSignals.urlParams.q.set(value);
    // Clear the instructorId filter when the user starts typing a search.
    this.viewSignals.urlParams.instructorId.set('');
  }

  filteredInstructors = computed(() => {
    // When instructorId is set, show only that specific instructor.
    const instructorId = this.instructorIdParam();
    if (instructorId) {
      const match = this.findInstructorsService.instructors.get(instructorId);
      return match ? [match] : [];
    }

    return this.findInstructorsService.instructors
      .search(this.searchTerm(), { strictDigits: true, interpretQuotesAsStrict: true })
      .filter((i) => i.instructorLicenseType !== 'None' && (i.instructorLicenseType as string) !== '');
  });
}
