import { Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member, MembershipType, InstructorLicenseType } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-member-row-header',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './member-row-header.html',
  styleUrl: './member-row-header.scss'
})
export class MemberRowHeaderComponent {
  member = input.required<Member>();
  isDirty = input<boolean>(false);

  todayIsoString = signal(new Date().toISOString().split('T')[0]);

  isMemberLicenseExpired = computed(() => {
    const expires = this.member().currentMembershipExpires;
    if (!expires || this.member().membershipType === MembershipType.Life) return null;
    if (expires >= this.todayIsoString()) return null;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? 'recent' : 'expired';
  });

  isInstructorLicenseExpired = computed(() => {
    const expires = this.member().instructorLicenseExpires;
    if (!expires || this.member().instructorLicenseType === InstructorLicenseType.Life) return null;
    if (expires >= this.todayIsoString()) return null;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? 'recent' : 'expired';
  });
}
