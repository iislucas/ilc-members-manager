"use strict";
/* docs-search-index.ts
 *
 * Full-text search index builder powered by MiniSearch, indexing across all 5 views,
 * code files, data types, user stories, and patterns.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocsSearchIndex = void 0;
const minisearch_1 = __importDefault(require("minisearch"));
class DocsSearchIndex {
    miniSearch;
    constructor() {
        this.miniSearch = new minisearch_1.default({
            fields: ['title', 'subtitle', 'content', 'tags'],
            storeFields: ['id', 'view', 'title', 'subtitle', 'url'],
            searchOptions: {
                boost: { title: 3, subtitle: 2, tags: 2 },
                fuzzy: 0.2,
                prefix: true,
            },
        });
    }
    addDocument(doc) {
        this.miniSearch.add(doc);
    }
    addDocuments(docs) {
        this.miniSearch.addAll(docs);
    }
    search(query, limit = 10) {
        if (!query || !query.trim())
            return [];
        return this.miniSearch.search(query).slice(0, limit);
    }
    toJSON() {
        return JSON.stringify(this.miniSearch.toJSON());
    }
    static fromJSON(jsonStr) {
        const instance = new DocsSearchIndex();
        instance.miniSearch = minisearch_1.default.loadJSON(jsonStr, {
            fields: ['title', 'subtitle', 'content', 'tags'],
            storeFields: ['id', 'view', 'title', 'subtitle', 'url'],
        });
        return instance;
    }
}
exports.DocsSearchIndex = DocsSearchIndex;
//# sourceMappingURL=docs-search-index.js.map