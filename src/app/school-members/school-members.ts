import { Component, computed, effect, inject, input } from '@angular/core';
import { DataManagerService } from '../data-manager.service';
import { MemberListComponent } from '../member-list/member-list';
import { School } from '../data-model';
import { SearchableMemberSet } from '../searchable-member-set.service';

@Component({
  selector: 'app-school-members',
  standalone: true,
  imports: [MemberListComponent],
  templateUrl: './school-members.html',
  styleUrl: './school-members.scss',
})
export class SchoolMembersComponent {
  school = input.required<School>();
  schoolId = computed(() => this.school().schoolId);
  private dataManager = inject(DataManagerService);
  memberSet = new SearchableMemberSet();

  constructor() {
    effect(async () => {
      const schoolId = this.schoolId();
      const members = await this.dataManager.getSchoolMembers(schoolId);
      this.memberSet.setMembers(members);
    });
  }
}
