import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member } from '../member.model';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-member-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './member-view.html',
  styleUrls: ['./member-view.scss'],
})
export class MemberViewComponent {
  member = input.required<Member>();
  adminEmail = environment.adminEmail;
}
