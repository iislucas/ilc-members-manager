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
import { AppPathPatterns } from '../app.config';

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
  routingService = inject(RoutingService<AppPathPatterns>);

  searchTerm = computed(() => {
    const match = this.routingService.matchedPatternId();
    if (!match) return '';
    const sigs = this.routingService.signals[match as keyof AppPathPatterns] as any;
    return sigs?.urlParams?.q ? sigs.urlParams.q() : '';
  });

  onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    const match = this.routingService.matchedPatternId();
    if (match) {
      const sigs = this.routingService.signals[match as keyof AppPathPatterns] as any;
      if (sigs?.urlParams?.q) {
        sigs.urlParams.q.set(value);
      }
    }
  }

  filteredInstructors = computed(() => {
    return this.findInstructorsService.instructors
      .search(this.searchTerm())
      .filter((i) => i.instructorLicenseType !== 'None' && (i.instructorLicenseType as string) !== '');
  });
}
