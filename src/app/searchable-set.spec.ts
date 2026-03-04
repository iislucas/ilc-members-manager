import { SearchableSet } from './searchable-set';

interface TestEntry {
  id: string;
  name: string;
}

describe('SearchableSet', () => {
  let searchableSet: SearchableSet<'id', TestEntry>;

  beforeEach(() => {
    searchableSet = new SearchableSet<'id', TestEntry>(['name'], 'id');
  });

  it('should initialize with empty entries', () => {
    expect(searchableSet.entries()).toEqual([]);
    expect(searchableSet.uniqueEntries()).toEqual([]);
    expect(searchableSet.duplicateEntries()).toEqual([]);
  });

  it('should handle entries without duplicates', () => {
    const entries = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];
    searchableSet.setEntries(entries);

    expect(searchableSet.entries().length).toBe(2);
    expect(searchableSet.uniqueEntries().length).toBe(2);
    expect(searchableSet.duplicateEntries().length).toBe(0);
  });

  it('should identify and separate duplicate IDs', () => {
    const entries = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '1', name: 'Alice Duplicate' }, // Duplicate ID '1'
    ];
    searchableSet.setEntries(entries);

    expect(searchableSet.entries().length).toBe(3);

    // uniqueEntries should ONLY contain entries whose ID is NOT shared by any other entry
    // Actually, based on my implementation:
    // duplicateIds = Set('1')
    // uniqueEntries = entries where !duplicateIds.has(id) -> only 'Bob' ('2')
    expect(searchableSet.uniqueEntries().length).toBe(1);
    expect(searchableSet.uniqueEntries()[0].id).toBe('2');

    // duplicateEntries should contain ALL entries sharing a duplicated ID
    expect(searchableSet.duplicateEntries().length).toBe(2);
    expect(searchableSet.duplicateEntries()[0].id).toBe('1');
    expect(searchableSet.duplicateEntries()[1].id).toBe('1');
  });

  it('should return unique entries on empty search', () => {
    const entries = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '1', name: 'Alice Duplicate' },
    ];
    searchableSet.setEntries(entries);

    const results = searchableSet.search('');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('2');
  });

  it('Setting the entries should result in the set going from false to true', () => {
    const entries = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '1', name: 'Alice Duplicate' },
    ];
    expect(searchableSet.loaded()).toBe(false);
    searchableSet.setEntries(entries);
    expect(searchableSet.loaded()).toBe(true);
  });

  it('should perform search only on unique entries', () => {
    const entries = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '1', name: 'Alice Duplicate' },
    ];
    searchableSet.setEntries(entries);

    // Searching for 'Alice' should yield NOTHING because 'Alice' is a duplicate and thus excluded from search index
    const resultsAlice = searchableSet.search('Alice');
    expect(resultsAlice.length).toBe(0);

    // Searching for 'Bob' should work
    const resultsBob = searchableSet.search('Bob');
    expect(resultsBob.length).toBe(1);
    expect(resultsBob[0].name).toBe('Bob');
  });

  it('should search within array fields', () => {
    interface TagEntry {
      id: string;
      name: string;
      tags: string[];
    }
    const tagSet = new SearchableSet<'id', TagEntry>(['name', 'tags'], 'id');
    const entries = [
      { id: '1', name: 'Alice', tags: ['expert', 'guru'] },
      { id: '2', name: 'Bob', tags: ['novice'] },
      { id: '3', name: 'Charlie', tags: ['expert'] },
    ];
    tagSet.setEntries(entries);

    const checkSearch = (term: string, expectedCount: number) => {
      const results = tagSet.search(term);
      expect(results.length).toBe(expectedCount);
    };

    checkSearch('expert', 2);
    checkSearch('guru', 1);
    checkSearch('novice', 1);
  });

  it('should use strict substring matching for purely numeric search terms when strictDigits is enabled', () => {
    const entries = [
      { id: '123', name: 'Alice' },
      { id: '456', name: 'Bob' },
      { id: '1234', name: 'Charlie' },
      { id: '789', name: 'Dana' },
    ];
    searchableSet.setEntries(entries);

    const opts = { strictDigits: true };

    // '123' should match '123' and '1234' by substring
    const results123 = searchableSet.search('123', opts);
    expect(results123.length).toBe(2);
    expect(results123.map((r) => r.id).sort()).toEqual(['123', '1234']);

    // '456' should match exactly one entry
    const results456 = searchableSet.search('456', opts);
    expect(results456.length).toBe(1);
    expect(results456[0].id).toBe('456');

    // '99' should match nothing
    const results99 = searchableSet.search('99', opts);
    expect(results99.length).toBe(0);
  });

  it('should NOT use strictDigits behaviour when the option is not set', () => {
    const entries = [
      { id: '123', name: 'Alice' },
      { id: '456', name: 'Bob' },
      { id: '1234', name: 'Charlie' },
    ];
    searchableSet.setEntries(entries);

    // Without strictDigits, numeric terms go through MiniSearch (fuzzy/prefix).
    // MiniSearch indexes the 'name' field, not IDs, so '123' won't find
    // anything useful — the important thing is it doesn't crash and doesn't
    // use the substring path.
    const results = searchableSet.search('123');
    // MiniSearch won't match any names, so we expect 0 results.
    expect(results.length).toBe(0);
  });

  it('should combine strict digit matching on ID with fuzzy matching on remaining text', () => {
    const entries = [
      { id: '123', name: 'Alice' },
      { id: '456', name: 'Alice' },
      { id: '1234', name: 'Bob' },
      { id: '789', name: 'Charlie' },
    ];
    searchableSet.setEntries(entries);

    const opts = { strictDigits: true };

    // '123 Alice' should require ID to contain '123' AND name to fuzzy-match 'Alice'.
    // Only id='123' name='Alice' should match (id='1234' has name='Bob').
    const results = searchableSet.search('123 Alice', opts);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('123');

    // '456 Alice' should match only id='456' name='Alice'.
    const results2 = searchableSet.search('456 Alice', opts);
    expect(results2.length).toBe(1);
    expect(results2[0].id).toBe('456');

    // '123 Bob' should match only id='1234' name='Bob'.
    const results3 = searchableSet.search('123 Bob', opts);
    expect(results3.length).toBe(1);
    expect(results3[0].id).toBe('1234');

    // '99 Alice' should match nothing (no ID contains '99').
    const results4 = searchableSet.search('99 Alice', opts);
    expect(results4.length).toBe(0);
  });

  describe('interpretQuotesAsStrict', () => {
    const opts = { interpretQuotesAsStrict: true };

    it('should require quoted substrings to appear in at least one searchable field', () => {
      const entries = [
        { id: 'a1', name: 'Alice Smith' },
        { id: 'a2', name: 'Alice Johnson' },
        { id: 'b1', name: 'Bob Smith' },
      ];
      searchableSet.setEntries(entries);

      // Only "Smith" as a strict filter — should return entries that contain "Smith".
      const results = searchableSet.search('"Smith"', opts);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.id).sort()).toEqual(['a1', 'b1']);
    });

    it('should combine quoted strict matching with fuzzy search for unquoted text', () => {
      const entries = [
        { id: 'a1', name: 'Alice Smith' },
        { id: 'a2', name: 'Alice Johnson' },
        { id: 'b1', name: 'Bob Smith' },
      ];
      searchableSet.setEntries(entries);

      // Fuzzy "Alice" + strict "Smith" — should only match Alice Smith.
      const results = searchableSet.search('Alice "Smith"', opts);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('a1');
    });

    it('should handle multiple quoted substrings', () => {
      const entries = [
        { id: 'a1', name: 'Alice Marie Smith' },
        { id: 'a2', name: 'Alice Smith' },
        { id: 'b1', name: 'Bob Marie Johnson' },
      ];
      searchableSet.setEntries(entries);

      // Both "Alice" and "Marie" required.
      const results = searchableSet.search('"Alice" "Marie"', opts);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('a1');
    });

    it('should match quoted substrings in array fields', () => {
      interface TagEntry {
        id: string;
        name: string;
        tags: string[];
      }
      const tagSet = new SearchableSet<'id', TagEntry>(
        ['name', 'tags'],
        'id',
      );
      const entries = [
        { id: '1', name: 'Alice', tags: ['expert', 'guru'] },
        { id: '2', name: 'Bob', tags: ['novice'] },
        { id: '3', name: 'Charlie', tags: ['expert'] },
      ];
      tagSet.setEntries(entries);

      const results = tagSet.search('"expert"', opts);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.id).sort()).toEqual(['1', '3']);
    });

    it('should be case-insensitive for quoted substrings', () => {
      const entries = [
        { id: 'a1', name: 'Alice Smith' },
        { id: 'b1', name: 'Bob Jones' },
      ];
      searchableSet.setEntries(entries);

      const results = searchableSet.search('"smith"', opts);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('a1');
    });

    it('should NOT fuzzy-match quoted substrings (e.g. "Chin" must not match "Chan")', () => {
      const entries = [
        { id: '1', name: 'Sam Chin' },
        { id: '2', name: 'Michael James Chan' },
        { id: '3', name: 'Li Chin Wei' },
      ];
      searchableSet.setEntries(entries);

      // "Chin" is strict — should only match names containing "Chin",
      // NOT "Chan" (which MiniSearch would fuzzy-match).
      const results = searchableSet.search('"Chin"', opts);
      expect(results.length).toBe(2);
      expect(results.map((r) => r.id).sort()).toEqual(['1', '3']);
    });
  });
});
