import { Component, inject } from '@angular/core';
import { MemberListComponent } from '../member-list/member-list';
import { DataManagerService } from '../data-manager.service';
import { SearchableMemberSet } from '../searchable-member-set.service';

@Component({
  selector: 'app-all-members',
  standalone: true,
  imports: [MemberListComponent],
  templateUrl: './all-members.html',
  styleUrl: './all-members.scss',
})
export class AllMembersComponent {
  private dataManager = inject(DataManagerService);
  memberSet = new SearchableMemberSet();

  constructor() {
    this.dataManager
      .getAllMembers()
      .then((members) => this.memberSet.setMembers(members));
  }
}
