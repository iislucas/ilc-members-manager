import { Component, inject, signal } from '@angular/core';
import { MemberListComponent } from './member-list/member-list';
import { Member } from './member.model';
import { MembersService } from './members.service';
import { CommonModule } from '@angular/common';
import { Timestamp } from 'firebase/firestore';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, MemberListComponent],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent {
  public membersService = inject(MembersService);
  selectedMember = signal<Member | null>(null);

  onNewMember() {
    const member: Member = {
      id: '',
      isAdmin: false,
      internal: {
        lastPaymentDate: Timestamp.now(),
        lastPaymentAmount: 0,
        lastPaymentId: 0,
        membershipExpires: Timestamp.now(),
        memberId: '',
        isInstructor: false,
      },
      public: {
        name: '',
        email: '',
        country: '',
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
