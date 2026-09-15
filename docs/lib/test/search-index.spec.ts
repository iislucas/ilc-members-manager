import { describe, it, expect } from 'vitest';
import { DocsSearchIndex, SearchDoc } from '../src/search/docs-search-index';

describe('DocsSearchIndex', () => {
  it('should index and perform fuzzy search across documentation entries', () => {
    const index = new DocsSearchIndex();
    const docs: SearchDoc[] = [
      {
        id: 'grading-doc',
        view: 'datatypes',
        title: 'Grading Data Model',
        subtitle: 'Curriculum & Grading Examination',
        content: 'Tracks student level progression, examiner evaluation, and payment settlement in Firestore.',
        tags: ['grading', 'curriculum', 'exam'],
        url: '#datatypes/grading',
      },
      {
        id: 'vod-flow',
        view: 'architecture',
        title: 'VOD Streaming Pipeline',
        subtitle: 'Media Transcoding & HLS',
        content: 'Transcodes master video using GCP Cloud Transcoder API and generates multi-bitrate HLS streams.',
        tags: ['vod', 'video', 'transcoder'],
        url: '#architecture/media-transcoding',
      },
      {
        id: 'init-pattern',
        view: 'patterns',
        title: 'The initXxx Zero-Default Pattern',
        subtitle: 'Data Architecture Pattern',
        content: 'Guarantees complete non-null default values for all properties to avoid undefined errors.',
        tags: ['init', 'defaults', 'converter'],
        url: '#patterns/init-zero-default-converter',
      },
    ];

    index.addDocuments(docs);

    const gradingResults = index.search('Grading');
    expect(gradingResults.length).toBeGreaterThan(0);
    expect(gradingResults[0].id).toBe('grading-doc');

    const fuzzyResults = index.search('trancoder'); // deliberate typo for fuzzy matching
    expect(fuzzyResults.length).toBeGreaterThan(0);
    expect(fuzzyResults[0].id).toBe('vod-flow');

    // Test serialization and deserialization
    const serialized = index.toJSON();
    const reloaded = DocsSearchIndex.fromJSON(serialized);
    const reloadedResults = reloaded.search('init');
    expect(reloadedResults.length).toBeGreaterThan(0);
    expect(reloadedResults[0].id).toBe('init-pattern');
  });
});
