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
});
