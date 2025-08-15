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
import { IconComponent } from '../../icons/icon.component';
import { FirebaseStateService } from '../../firebase-state.service';
import { MembersService } from '../members.service';
import { SpinnerComponent } from '../../spinner/spinner.component';

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
  private firebaseStateService = inject(FirebaseStateService);

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
        member.public.email?.toLowerCase() ===
          self.editableMember.public.email?.toLowerCase() &&
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
        member.internal.memberId?.toLowerCase() ===
          self.editableMember.internal.memberId?.toLowerCase() &&
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
    } else if (this.editableMember.public.name === '') {
      this.errorMessage.set('Name cannot be empty.');
      this.isSaving.set(false);
      return;
    } else if (
      !this.editableMember.id &&
      this.editableMember.internal.memberId === ''
    ) {
      this.errorMessage.set('Member ID cannot be empty for a new member.');
      this.isSaving.set(false);
      return;
    }
    this.errorMessage.set('');

    if (this.editableMember.id) {
      const originalMember = await this.membersService.getMember(
        this.editableMember.id
      );
      if (
        originalMember &&
        originalMember.isAdmin !== this.editableMember.isAdmin
      ) {
        if (this.editableMember.isAdmin) {
          try {
            await this.firebaseStateService.addAdmin(
              this.editableMember.id,
              this.editableMember.public.email
            );
          } catch (e: any) {
            this.errorMessage.set(e.message);
            this.editableMember.isAdmin = false;
            this.isSaving.set(false);
            return;
          }
        } else {
          try {
            await this.firebaseStateService.removeAdmin(
              this.editableMember.id,
              this.editableMember.public.email
            );
          } catch (e: unknown) {
            if (e instanceof Error) {
              this.errorMessage.set(e.message);
            } else {
              this.errorMessage.set('An unknown error occurred.');
            }
            this.editableMember.isAdmin = true;
            this.isSaving.set(false);
            return;
          }
        }
      }
      await this.membersService.updateMember(
        this.editableMember.id,
        this.editableMember
      );
    } else {
      const newMemberRef = await this.membersService.addMember(
        this.editableMember
      );
      if (this.editableMember.isAdmin) {
        await this.firebaseStateService.addAdmin(
          newMemberRef.id,
          this.editableMember.public.email
        );
      }
    }
    this.close.emit();
    this.isSaving.set(false);
  }

  async deleteMember($event: Event) {
    $event.preventDefault();
    $event.stopPropagation();
    if (
      confirm(
        `Are you sure you want to delete ${this.editableMember.public.name}?`
      )
    ) {
      if (this.editableMember.id) {
        await this.membersService.deleteMember(this.editableMember.id);
        if (this.editableMember.isAdmin) {
          await this.firebaseStateService.removeAdmin(
            this.editableMember.id,
            this.editableMember.public.email
          );
        }
      }
      this.close.emit();
    }
  }

  closeError() {
    this.errorMessage.set('');
  }

  validateForm() {
    if (this.editableMember.public.name === '') {
      this.errorMessage.set('Name cannot be empty.');
    } else if (
      !this.editableMember.id &&
      this.editableMember.internal.memberId === ''
    ) {
      this.errorMessage.set('Member ID cannot be empty for a new member.');
    } else {
      this.errorMessage.set('');
    }
  }
}
