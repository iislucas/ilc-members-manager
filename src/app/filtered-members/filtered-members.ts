import { Component, computed, effect, inject, input } from '@angular/core';
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
  errorMessage = computed(() => {
    return this.memberSet().error() || this.filteredMemberSet.error();
  });

  constructor() {
    effect(() => {
      if (this.memberSet().loaded()) {
        let filteredSet = this.memberSet().entries();
        if (this.schoolId() !== '') {
          filteredSet = filteredSet.filter(
            (m) => m.managingOrgId === this.schoolId(),
          );
        }
        if (this.country() !== '') {
          filteredSet = filteredSet.filter((m) => m.country === this.country());
        }
        this.filteredMemberSet.setEntries(filteredSet);
      }
    });
  }
}
