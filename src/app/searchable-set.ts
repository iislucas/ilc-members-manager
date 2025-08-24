import { computed, signal } from '@angular/core';
import MiniSearch from 'minisearch';

// TODO: add caching of the memberset in localstorage? Or indexDB?
export class SearchableSet<T extends { id: string }> {
  // A signal to hold the state of the members list.
  private state = signal<{
    entries: T[];
    loading: boolean;
    error: string | null;
  }>({
    entries: [],
    loading: true,
    error: null,
  });

  // Expose computed signals for easy access in components.
  entries = computed(() => this.state().entries);
  loading = computed(() => this.state().loading);
  error = computed(() => this.state().error);

  constructor(private fieldsToSearch: string[] = [], entries?: T[]) {
    if (entries) {
      this.setEntries(entries);
    }
  }

  private membersMiniSearch = computed(() => {
    const miniSearch = new MiniSearch<T>({
      fields: this.fieldsToSearch,
      storeFields: ['id'],
      idField: 'id',
    });
    miniSearch.addAll(this.entries());
    return miniSearch;
  });

  private memberMap = computed(() => {
    const map = new Map<string, T>();
    for (const e of this.entries()) {
      map.set(e.id, e);
    }
    return map;
  });

  setEntries(entries: T[]) {
    this.state.update((state) => ({ ...state, entries, loading: false }));
  }

  setError(error: string) {
    this.state.update((state) => ({ ...state, error, loading: false }));
  }

  search(term: string): T[] {
    let entries: T[];
    if (!term) {
      entries = this.entries();
    } else {
      const results = this.membersMiniSearch().search(term, { fuzzy: 0.2 });
      entries = results.map((result) => this.memberMap().get(result.id)!);
    }
    return entries;
  }
}
