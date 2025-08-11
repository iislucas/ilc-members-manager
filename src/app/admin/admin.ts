import { Component, inject, signal } from '@angular/core';
import { MemberListComponent } from './member-list/member-list';
import { MemberEditComponent } from './member-edit/member-edit';
import { Member } from './member.model';
import { MembersService } from './members.service';
import { CommonModule } from '@angular/common';
import { Timestamp } from 'firebase/firestore';
import { FirebaseStateService } from '../firebase-state.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, MemberListComponent, MemberEditComponent],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent {
  public membersService = inject(MembersService);
  private firebaseStateService = inject(FirebaseStateService);
  selectedMember = signal<Member | null>(null);

  onSelectMember(member: Member) {
    this.selectedMember.set(member);
  }

  async onSaveMember(member: Member) {
    if (member.id) {
      const originalMember = await this.membersService.getMember(member.id);
      if (originalMember && originalMember.isAdmin !== member.isAdmin) {
        if (member.isAdmin) {
          await this.firebaseStateService.addAdmin(
            member.id,
            member.public.email
          );
        } else {
          await this.firebaseStateService.removeAdmin(
            member.id,
            member.public.email
          );
        }
      }
      this.membersService.updateMember(member.id, member);
    } else {
      const newMember = await this.membersService.addMember(member);
      if (member.isAdmin) {
        await this.firebaseStateService.addAdmin(
          newMember.id,
          member.public.email
        );
      }
    }
    this.selectedMember.set(null);
  }

  onNewMember() {
    const member: Member = {
      id: '',
      isAdmin: false,
      internal: {
        lastPaymentDate: Timestamp.now(),
        lastPaymentAmount: 0,
        lastPaymentId: 0,
        membershipExpires: Timestamp.now(),
      },
      public: {
        name: '',
        email: '',
        studentLevel: '',
        applicationLevel: '',
        isSchoolManager: false,
        isCountryManager: false,
      },
    };
    this.selectedMember.set(member);
  }

  onClose() {
    this.selectedMember.set(null);
  }
}
