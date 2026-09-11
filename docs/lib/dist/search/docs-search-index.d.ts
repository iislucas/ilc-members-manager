export interface SearchDoc {
    id: string;
    view: 'setup' | 'journeys' | 'plans' | 'datatypes' | 'architecture' | 'patterns' | 'files' | 'stories';
    title: string;
    subtitle: string;
    content: string;
    tags: string[];
    url: string;
}
export declare class DocsSearchIndex {
    private miniSearch;
    constructor();
    addDocument(doc: SearchDoc): void;
    addDocuments(docs: SearchDoc[]): void;
    search(query: string, limit?: number): import("minisearch").SearchResult[];
    toJSON(): string;
    static fromJSON(jsonStr: string): DocsSearchIndex;
}
//# sourceMappingURL=docs-search-index.d.ts.map