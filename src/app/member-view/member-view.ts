import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member } from '../data-model';
import { environment } from '../../environments/environment';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-member-view',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './member-view.html',
  styleUrls: ['./member-view.scss'],
})
export class MemberViewComponent {
  member = input.required<Member>();
  adminEmail = environment.adminEmail;
}
