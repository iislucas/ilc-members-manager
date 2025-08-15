import { Component, input, output, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member } from '../member.model';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../icons/icon.component';
import { FirebaseStateService } from '../../firebase-state.service';
import { MembersService } from '../members.service';

@Component({
  selector: 'app-member-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
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
  private membersService = inject(MembersService);
  private firebaseStateService = inject(FirebaseStateService);

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

  isDupEmail() {
    const self = this;
    if (!this.allMembers || !this.editableMember) {
      this.emailExists = false;
      return false;
    }
    this.emailExists = this.allMembers().some((member) => {
      return (
        member.public.email.toLowerCase() ===
          self.editableMember.public.email.toLowerCase() &&
        member.id !== self.editableMember.id
      );
    });
    return this.emailExists;
  }

  async saveMember() {
    if (this.editableMember.id) {
      const originalMember = await this.membersService.getMember(
        this.editableMember.id
      );
      if (
        originalMember &&
        originalMember.isAdmin !== this.editableMember.isAdmin
      ) {
        if (this.editableMember.isAdmin) {
          await this.firebaseStateService.addAdmin(
            this.editableMember.id,
            this.editableMember.public.email
          );
        } else {
          await this.firebaseStateService.removeAdmin(
            this.editableMember.id,
            this.editableMember.public.email
          );
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
}
