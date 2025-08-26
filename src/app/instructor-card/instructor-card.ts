import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  InstructorPublicData,
  Member,
} from '../../../functions/src/data-model';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-instructor-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './instructor-card.html',
  styleUrl: './instructor-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstructorCardComponent {
  instructor = input.required<InstructorPublicData>();
}
