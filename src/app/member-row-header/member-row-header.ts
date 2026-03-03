import { Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Member, MembershipType, InstructorLicenseType, ExpiryStatus } from '../../../functions/src/data-model';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-member-row-header',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './member-row-header.html',
  styleUrl: './member-row-header.scss'
})
export class MemberRowHeaderComponent {
  ExpiryStatus = ExpiryStatus;

  member = input.required<Member>();
  isDirty = input<boolean>(false);

  todayIsoString = signal(new Date().toISOString().split('T')[0]);

  isMemberLicenseExpired = computed((): ExpiryStatus => {
    const member = this.member();
    const type = member.membershipType;

    // Life memberships never expire.
    if (type === MembershipType.Life) return ExpiryStatus.Valid;

    // If the membership type is not a recognized active type, treat as an issue.
    const activeTypes: string[] = [
      MembershipType.Annual, MembershipType.Life,
    ];
    if (!activeTypes.includes(type)) return ExpiryStatus.Issue;

    // If it's an annual-style membership but no expiry date is set, treat as an issue.
    const expires = member.currentMembershipExpires;
    if (!expires) return ExpiryStatus.Issue;

    if (expires >= this.todayIsoString()) return ExpiryStatus.Valid;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
  });

  isInstructorLicenseExpired = computed((): ExpiryStatus => {
    const expires = this.member().instructorLicenseExpires;
    if (!expires || this.member().instructorLicenseType === InstructorLicenseType.Life) return ExpiryStatus.Valid;
    if (expires >= this.todayIsoString()) return ExpiryStatus.Valid;

    const expireDate = new Date(expires);
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return expireDate >= sixMonthsAgo ? ExpiryStatus.Recent : ExpiryStatus.Expired;
  });
}
