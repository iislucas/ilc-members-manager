import { Component, inject } from '@angular/core';
import { MemberListComponent } from '../member-list/member-list';
import { DataManagerService } from '../data-manager.service';
import { SearchableMemberSet } from '../searchable-member-set';

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
    effect(async () => {
      const state = await this.dataManager.memberSet();
      if(!state.loading) {
        this.memberSet.setMembers(state.members)
      }
      .getAllMembers()
      .then((members) => );
  }
}
