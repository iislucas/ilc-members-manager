import { computed, signal } from '@angular/core';
import MiniSearch from 'minisearch';

// TODO: add caching of the memberset in localstorage? Or indexDB?
export class SearchableSet<
  ID extends string,
  T extends { [key in ID]: string },
> {
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
  loaded = computed(() => !this.loading() && this.error() === null);

  uniqueEntries = computed(() => {
    const entries = this.entries();
    const unique = [];
    const duplicateIds = this.duplicateIds();
    for (const entry of entries) {
      const id = entry[this.idField];
      if (!duplicateIds.has(id)) {
        unique.push(entry);
      }
    }
    return unique;
  });

  private duplicateIds = computed(() => {
    const entries = this.entries();
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const entry of entries) {
      const id = entry[this.idField];
      if (seen.has(id)) {
        dups.add(id);
      }
      seen.add(id);
    }
    return dups;
  });

  duplicateEntries = computed(() => {
    const entries = this.entries();
    const dups = [];
    const duplicateIds = this.duplicateIds();
    for (const entry of entries) {
      if (duplicateIds.has(entry[this.idField])) {
        dups.push(entry);
      }
    }
    return dups;
  });

  constructor(
    public fieldsToSearch: string[],
    public idField: ID,
    entries?: T[],
  ) {
    if (entries) {
      this.setEntries(entries);
    }
  }

  private membersMiniSearch = computed(() => {
    const miniSearch = new MiniSearch<T>({
      fields: this.fieldsToSearch,
      storeFields: [this.idField],
      idField: this.idField,
      /* TODO consider if this is needed.
      extractField: (document, fieldName) => {
        // Access nested fields
        const value = fieldName
          .split('.')
          .reduce((doc: any, key) => doc && doc[key], document);
        if (Array.isArray(value)) {
          return value.join(' ');
        }
        return value as string;
      },*/
    });
    const entries = this.uniqueEntries();
    console.log(
      'membersMiniSearch computed, adding',
      entries.length,
      'entries',
    );
    miniSearch.addAll(entries);
    return miniSearch;
  });

  public entriesMap = computed(() => {
    const map = new Map<string, T>();
    for (const e of this.uniqueEntries()) {
      map.set(e[this.idField], e);
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
      entries = this.uniqueEntries();
    } else {
      const results = this.membersMiniSearch().search(term, {
        fuzzy: 0.2,
        prefix: true,
      });
      entries = results.map((result) => this.entriesMap().get(result.id)!);
    }
    return entries;
  }
}
