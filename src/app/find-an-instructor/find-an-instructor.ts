import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MembersService } from '../members.service';
import { Member } from '../member.model';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-find-an-instructor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './find-an-instructor.html',
  styleUrl: './find-an-instructor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FindAnInstructor {
  private membersService = inject(MembersService);
}
