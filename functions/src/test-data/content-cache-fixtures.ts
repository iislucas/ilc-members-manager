/* test-data/content-cache-fixtures.ts
 *
 * Minimal test fixtures for content-cache.spec.ts. Based on real data
 * from the live Squarespace and Google Calendar APIs but stripped down
 * to only the fields the caching code actually uses.
 */

import { GoogleCalendarEventItem } from '../calendar.types';

// ------------------------------------------------------------------
// Google Calendar API response fixtures
// ------------------------------------------------------------------

// A timed event (has dateTime, not just date).
export const timedCalendarEvent: GoogleCalendarEventItem = {
  id: 'evt-timed-001',
  summary: 'Loose, Soft, and Elastic Energies with Jeffrey Wong',
  start: {
    dateTime: '2026-03-07T19:00:00Z',
  },
  end: {
    dateTime: '2026-03-07T20:30:00Z',
  },
  location: 'Zoom - Online',
  description: '<p>Join us LIVE! Mar 7, 2026 02:00 PM Eastern Time</p>',
  htmlLink: 'https://www.google.com/calendar/event?eid=abc123',
};

// An all-day event (has date, not dateTime).
export const allDayCalendarEvent: GoogleCalendarEventItem = {
  id: 'evt-allday-001',
  summary: 'Annual ILC Retreat 2026',
  start: {
    date: '2026-06-15',
  },
  end: {
    // Google Calendar all-day events: end date is exclusive, so a
    // 3-day event June 15–17 has end date June 18.
    date: '2026-06-18',
  },
  location: 'ILC Center, Kuala Lumpur, Malaysia',
  description: 'Annual retreat with Grandmaster Sam Chin.',
  htmlLink: 'https://www.google.com/calendar/event?eid=def456',
};

// An event with no location.
export const noLocationEvent: GoogleCalendarEventItem = {
  id: 'evt-noloc-001',
  summary: 'Online Members Meeting',
  start: {
    dateTime: '2026-04-01T18:00:00Z',
  },
  end: {
    dateTime: '2026-04-01T19:00:00Z',
  },
  location: '',
  description: '',
  htmlLink: '',
};

// An event with no summary.
export const noSummaryEvent: GoogleCalendarEventItem = {
  id: 'evt-nosum-001',
  summary: '',
  start: {
    dateTime: '2026-05-01T10:00:00Z',
  },
  end: {
    dateTime: '2026-05-01T11:00:00Z',
  },
  description: 'Untitled event',
  htmlLink: '',
};

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
