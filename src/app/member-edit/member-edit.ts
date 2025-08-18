import {
  Component,
  input,
  output,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member } from '../member.model';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icons/icon.component';
import { FirebaseStateService } from '../firebase-state.service';
import { MembersService } from '../members.service';
import { SpinnerComponent } from '../spinner/spinner.component';

@Component({
  selector: 'app-member-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, SpinnerComponent],
  templateUrl: './member-edit.html',
  styleUrl: './member-edit.scss',
})
export class MemberEditComponent {
  member = input.required<Member>();
  allMembers = input.required<Member[]>();
  canDelete = input<boolean>(true);
  close = output();

  editableMember!: Member;
  emailExists = false;
  memberIdExists = false;
  errorMessage = signal('');
  isSaving = signal(false);
  private membersService = inject(MembersService);

  constructor() {
    effect(() => {
      this.editableMember = JSON.parse(JSON.stringify(this.member()));
      this.validateForm();
    });
  }

  cancel($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    this.close.emit();
  }

  isDupEmail() {
    const self = this;
    if (!this.allMembers || !this.editableMember) {
      this.emailExists = false;
      return false;
    }
    this.emailExists = this.allMembers().some((member) => {
      return (
        member.email?.toLowerCase() ===
          self.editableMember.email?.toLowerCase() &&
        member.id !== self.editableMember.id
      );
    });
    return this.emailExists;
  }

  isDupMemberId() {
    const self = this;
    if (!this.allMembers || !this.editableMember) {
      this.memberIdExists = false;
      return false;
    }
    this.memberIdExists = this.allMembers().some((member) => {
      return (
        member.memberId?.toLowerCase() ===
          self.editableMember.memberId?.toLowerCase() &&
        member.id !== self.editableMember.id
      );
    });
    return this.memberIdExists;
  }

  async saveMember() {
    this.isSaving.set(true);
    if (this.isDupEmail()) {
      this.errorMessage.set('This email address is already in use.');
      this.isSaving.set(false);
      return;
    } else if (this.isDupMemberId()) {
      this.errorMessage.set('This member ID is already in use.');
      this.isSaving.set(false);
      return;
    } else if (this.editableMember.name === '') {
      this.errorMessage.set('Name cannot be empty.');
      this.isSaving.set(false);
      return;
    } else if (!this.editableMember.id && this.editableMember.memberId === '') {
      this.errorMessage.set('Member ID cannot be empty for a new member.');
      this.isSaving.set(false);
      return;
    }
    this.errorMessage.set('');

    if (this.editableMember.email) {
      await this.membersService.updateMember(
        this.editableMember.email,
        this.editableMember
      );
    } else {
      await this.membersService.addMember(this.editableMember);
    }
    this.close.emit();
    this.isSaving.set(false);
  }

  async deleteMember($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    if (
      confirm(`Are you sure you want to delete ${this.editableMember.name}?`)
    ) {
      if (this.editableMember.id) {
        await this.membersService.deleteMember(this.editableMember.id);
      }
      this.close.emit();
    }
  }

  closeError() {
    this.errorMessage.set('');
  }

  validateForm() {
    if (this.editableMember.name === '') {
      this.errorMessage.set('Name cannot be empty.');
    } else if (!this.editableMember.id && this.editableMember.memberId === '') {
      this.errorMessage.set('Member ID cannot be empty for a new member.');
    } else {
      this.errorMessage.set('');
    }
  }
}
