import { Component, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member } from '../member.model';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../icons/icon.component';

@Component({
  selector: 'app-member-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './member-edit.html',
  styleUrl: './member-edit.scss',
})
export class MemberEditComponent {
  member = input.required<Member>();
  close = output();
  save = output<Member>();
  delete = output<Member>();

  editableMember!: Member;

  constructor() {
    effect(() => {
      this.editableMember = JSON.parse(JSON.stringify(this.member()));
    });
  }

  cancel($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    this.close.emit();
  }

  deleteMember($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    if (
      confirm(
        `Are you sure you want to delete ${this.editableMember.public.name}?`
      )
    ) {
      this.delete.emit(this.editableMember);
    }
  }
}
