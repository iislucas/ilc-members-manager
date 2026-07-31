/* test-data/content-cache-fixtures.ts
 *
 * Minimal test fixtures for content-cache.spec.ts. Based on real data
 * from the live Squarespace API but stripped down to only the fields
 * the caching code actually uses.
 */

// ------------------------------------------------------------------
// Squarespace blog API response fixtures
// ------------------------------------------------------------------

export const squarespaceBaseUrl = 'https://www.iliqchuan.com';

// A realistic Squarespace blog item with all the fields the code reads.
export const memberBlogItem = {
  id: '69a3367811eb915ea8b8bfc6',
  urlId: 'investing-in-loss',
  title: 'Investing in Loss',
  publishOn: 1772305190049,
  addedOn: 1772305190049,
  categories: ['Community'],
  tags: ['Blog', 'Members'],
  author: { displayName: 'Yen Lee Chin' },
  assetUrl: 'https://static1.squarespace.com/static/6779aa49/image.jpg',
  excerpt: '<p style="white-space:pre-wrap;">A members\' story on their ILC training path</p>',
  body: '<div class="sqs-layout"><p>Long form content here.</p></div>',
};

// A blog item with protocol-relative URLs and lazy-loaded images.
export const blogItemWithProtocolRelativeUrls = {
  id: '69aa82cf60bf4302be1a6596',
  urlId: 'elastic-energies',
  title: 'Elastic Energies',
  publishOn: 1772782366358,
  addedOn: 1772782366358,
  categories: ['Zoom Classes'],
  tags: ['Zoom Classes', 'Jeffrey Wong'],
  author: { displayName: 'Yen Lee Chin' },
  assetUrl: '',
  excerpt: '<p class="loading">Excerpt</p>',
  body: '<div><img src="//placeholder.jpg" data-src="https://cdn.sqsp.com/real-image.jpg" class="loading"><a href="//www.example.com/link">Link</a></div>',
};

// A blog item with a Squarespace video embed wrapper.
export const blogItemWithVideoEmbed = {
  id: 'video-post-001',
  urlId: 'video-lesson',
  title: 'Video Lesson: Spinning Force',
  publishOn: 1770000000000,
  addedOn: 1770000000000,
  categories: ['Video'],
  tags: ['Video', 'Technique'],
  author: { displayName: 'Sam Chin' },
  assetUrl: '',
  excerpt: '',
  body: '<div class="sqs-video-wrapper" data-html="&lt;iframe src=&quot;https://www.youtube.com/embed/abc&quot;&gt;&lt;/iframe&gt;"></div>',
};

// A blog item with a relative asset URL.
export const blogItemWithRelativeAssetUrl = {
  id: 'rel-asset-001',
  urlId: 'relative-asset-post',
  title: 'Post with Relative Asset',
  publishOn: 1771000000000,
  addedOn: 1771000000000,
  categories: [],
  tags: [],
  author: {},
  assetUrl: '/images/local-photo.jpg',
  excerpt: '',
  body: '<p>Content with <a href="/about">relative link</a></p>',
};

// A blog item with problematic assetUrl values.
export const blogItemWithBadAssetUrl = {
  id: 'bad-asset-001',
  urlId: 'bad-asset-post',
  title: 'Post with Bad Asset',
  publishOn: 1769000000000,
  addedOn: 1769000000000,
  categories: [],
  tags: [],
  author: {},
  assetUrl: 'undefined',
  excerpt: '',
  body: '<p>Body</p>',
};

// A minimal Squarespace API response wrapping a list of blog items.
export function makeSquarespaceApiResponse(items: Record<string, unknown>[]) {
  return {
    website: {
      baseUrl: squarespaceBaseUrl,
    },
    items,
  };
}
