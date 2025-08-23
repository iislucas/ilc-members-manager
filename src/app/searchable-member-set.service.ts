import { computed, signal } from '@angular/core';
import { Member } from './data-model';
import MiniSearch from 'minisearch';

export class SearchableMemberSet {
  // A signal to hold the state of the members list.
  private state = signal<{
    members: Member[];
    loading: boolean;
    error: string | null;
  }>({
    members: [],
    loading: true,
    error: null,
  });

  // Expose computed signals for easy access in components.
  members = computed(() => this.state().members);
  loading = computed(() => this.state().loading);
  error = computed(() => this.state().error);

  private membersMiniSearch = computed(() => {
    const miniSearch = new MiniSearch<Member>({
      fields: [
        'memberId',
        'instructorId',
        'name',
        'email',
        'memberId',
        'city',
        'country',
      ],
      storeFields: ['id'],
      idField: 'id',
    });
    miniSearch.addAll(this.members());
    return miniSearch;
  });

  private memberMap = computed(() => {
    const map = new Map<string, Member>();
    for (const member of this.members()) {
      map.set(member.id, member);
    }
    return map;
  });

  setMembers(members: Member[]) {
    this.state.update((state) => ({ ...state, members, loading: false }));
  }

  searchMembers(term: string, country?: string): Member[] {
    let members: Member[];
    if (!term) {
      members = this.members();
    } else {
      const results = this.membersMiniSearch().search(term, { fuzzy: 0.2 });
      members = results.map((result) => this.memberMap().get(result.id)!);
    }
    if (country) {
      members = members.filter((m) => m.country === country);
    }
    return members;
  }
}
