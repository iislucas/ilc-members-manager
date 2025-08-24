import { Component, effect, inject, input } from '@angular/core';
import { MemberListComponent } from '../member-list/member-list';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { Member } from '../../../functions/src/data-model';

@Component({
  selector: 'app-filtered-members',
  standalone: true,
  imports: [MemberListComponent],
  templateUrl: './filtered-members.html',
  styleUrl: './filtered-members.scss',
})
export class FilteredMembersComponent {
  memberSet = input.required<SearchableSet<Member>>();
  schoolId = input<string>('');
  country = input<string>('');
  jumpToMember = input<string>('');
  filteredMemberSet = new SearchableSet<Member>();

  constructor() {
    effect(() => {
      if (this.memberSet().loaded()) {
        let initialSet = this.memberSet().entries();
        if (this.schoolId() !== '') {
          initialSet = initialSet.filter(
            (m) => m.managingOrgId === this.schoolId()
          );
        }
        if (this.country() !== '') {
          initialSet = initialSet.filter((m) => m.country === this.country());
        }
      }
    });
  }
}
