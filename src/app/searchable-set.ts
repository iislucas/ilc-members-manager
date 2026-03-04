import { computed, signal } from '@angular/core';
import MiniSearch from 'minisearch';

export type SearchOptions = {
  /** When true, purely numeric search terms use strict ID substring matching
   * instead of MiniSearch fuzzy search. */
  strictDigits?: boolean;  // default: false
  /** When true, substrings wrapped in double quotes (e.g. "foo") are required
   * to appear as a case-insensitive substring in at least one searchable field. */
  interpretQuotesAsStrict?: boolean;  // default: true
};

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
      if (id && !duplicateIds.has(id)) {
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
      if (!id) continue;
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

  missingIdEntries = computed(() => {
    const entries = this.entries();
    const missing = [];
    for (const entry of entries) {
      if (!entry[this.idField]) {
        missing.push(entry);
      }
    }
    return missing;
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
      idField: this.idField as string,
    });
    const entries = this.uniqueEntries();
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

  get(id: string): T | undefined {
    return this.entriesMap().get(id);
  }

  setEntries(entries: T[]) {
    this.state.update((state) => ({ ...state, entries, loading: false }));
  }

  setError(error: string) {
    this.state.update((state) => ({ ...state, error, loading: false }));
  }

  search(term: string, options: SearchOptions = { strictDigits: false, interpretQuotesAsStrict: true }): T[] {
    if (!term) {
      return this.uniqueEntries();
    }

    const opts = options ?? {};

    let requiredIdSubstrings: string[] = [];
    let requiredFieldSubstrings: string[] = [];
    let fuzzyTerm = term;

    // When interpretQuotesAsStrict is enabled, extract "quoted" substrings
    // and require each as a case-insensitive match across the searchable fields.
    if (opts.interpretQuotesAsStrict) {
      requiredFieldSubstrings = [...fuzzyTerm.matchAll(/"([^"]+)"/g)].map(
        (m) => m[1].toLowerCase(),
      );
      fuzzyTerm = fuzzyTerm.replace(/"[^"]*"/g, '').trim();
    }

    // When strictDigits is enabled, extract purely-numeric tokens and require
    // each as a strict substring match on the ID field.
    if (opts.strictDigits) {
      const tokens = fuzzyTerm.split(/\s+/);
      const digitTokens = tokens.filter((t) => /^\d+$/.test(t));
      const nonDigitTokens = tokens.filter((t) => !/^\d+$/.test(t));
      requiredIdSubstrings = digitTokens;
      fuzzyTerm = nonDigitTokens.join(' ').trim();
    }

  // Start with MiniSearch results for the remaining fuzzy portion, or all
  // entries if there's nothing left for MiniSearch.
    let entries: T[];
    if (fuzzyTerm) {
      const results = this.membersMiniSearch().search(fuzzyTerm, {
        fuzzy: 0.2,
        prefix: true,
      });
      entries = results.map((result) => this.get(result.id)!);
    } else {
      entries = this.uniqueEntries();
    }

    // Filter by required ID substrings (from numeric tokens).
    if (requiredIdSubstrings.length > 0) {
      entries = entries.filter((entry) =>
        requiredIdSubstrings.every((sub) => entry[this.idField].includes(sub)),
      );
    }

    // Filter by required field substrings (from quoted terms).
    if (requiredFieldSubstrings.length > 0) {
      const allFields = [this.idField as string, ...this.fieldsToSearch];
      entries = entries.filter((entry) =>
        requiredFieldSubstrings.every((sub) =>
          allFields.some((field) => {
            const val = (entry as Record<string, unknown>)[field];
            if (typeof val === 'string') {
              return val.toLowerCase().includes(sub);
            }
            if (Array.isArray(val)) {
              return val.some(
                (v) => typeof v === 'string' && v.toLowerCase().includes(sub),
              );
            }
            return false;
          }),
        ),
      );
    }

    return entries;
  }
}
