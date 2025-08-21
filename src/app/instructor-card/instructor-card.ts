import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Member } from '../member.model';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-instructor-card',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './instructor-card.html',
  styleUrl: './instructor-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstructorCardComponent {
  instructor = input.required<Member>();
}
