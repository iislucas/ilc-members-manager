import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member } from '../member.model';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-member-edit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './member-edit.html',
  styleUrl: './member-edit.scss',
})
export class MemberEditComponent {
  member = input.required<Member>();
  close = output();
  save = output<Member>();
}
