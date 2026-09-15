/* docs-search-index.ts
 *
 * Full-text search index builder powered by MiniSearch, indexing across all 5 views,
 * code files, data types, user stories, and patterns.
 */

import MiniSearch from 'minisearch';

export interface SearchDoc {
  id: string;
  view: 'setup' | 'journeys' | 'plans' | 'datatypes' | 'architecture' | 'patterns' | 'files' | 'stories';
  title: string;
  subtitle: string;
  content: string;
  tags: string[];
  url: string;
}

export class DocsSearchIndex {
  private miniSearch: MiniSearch<SearchDoc>;

  constructor() {
    this.miniSearch = new MiniSearch<SearchDoc>({
      fields: ['title', 'subtitle', 'content', 'tags'],
      storeFields: ['id', 'view', 'title', 'subtitle', 'url'],
      searchOptions: {
        boost: { title: 3, subtitle: 2, tags: 2 },
        fuzzy: 0.2,
        prefix: true,
      },
    });
  }

  public addDocument(doc: SearchDoc): void {
    this.miniSearch.add(doc);
  }

  public addDocuments(docs: SearchDoc[]): void {
    this.miniSearch.addAll(docs);
  }

  public search(query: string, limit = 10) {
    if (!query || !query.trim()) return [];
    return this.miniSearch.search(query).slice(0, limit);
  }

  public toJSON(): string {
    return JSON.stringify(this.miniSearch.toJSON());
  }

  public static fromJSON(jsonStr: string): DocsSearchIndex {
    const instance = new DocsSearchIndex();
    instance.miniSearch = MiniSearch.loadJSON<SearchDoc>(jsonStr, {
      fields: ['title', 'subtitle', 'content', 'tags'],
      storeFields: ['id', 'view', 'title', 'subtitle', 'url'],
    });
    return instance;
  }
}
