import { describe, it, expect } from 'vitest';
import {
  getEventEndDate,
  mapToCalendarEvent,
  processSquarespaceHtml,
  cleanAssetUrl,
  mapToCachedBlogPost,
  contentChanged,
} from './content-cache';
import {
  timedCalendarEvent,
  allDayCalendarEvent,
  noLocationEvent,
  noSummaryEvent,
  squarespaceBaseUrl,
  memberBlogItem,
  blogItemWithProtocolRelativeUrls,
  blogItemWithVideoEmbed,
  blogItemWithRelativeAssetUrl,
  blogItemWithBadAssetUrl,
} from './test-data/content-cache-fixtures';

// ==================================================================
// getEventEndDate
// ==================================================================
describe('getEventEndDate', () => {
  it('should return dateTime when present', () => {
    expect(getEventEndDate({ dateTime: '2026-03-07T20:30:00Z' })).toBe('2026-03-07T20:30:00Z');
  });

  it('should subtract one day for all-day events (exclusive end date)', () => {
    // Google Calendar: a 3-day event June 15–17 has end = June 18.
    // We subtract 1 to get the last actual day.
    const result = getEventEndDate({ date: '2026-06-18' });
    expect(result).toBe('2026-06-17');
  });

  it('should prefer dateTime over date', () => {
    expect(getEventEndDate({ dateTime: '2026-01-01T10:00:00Z', date: '2026-01-01' })).toBe('2026-01-01T10:00:00Z');
  });

  it('should return N/A when end is undefined', () => {
    expect(getEventEndDate(undefined)).toBe('N/A');
  });

  it('should return N/A when end object has no fields', () => {
    expect(getEventEndDate({})).toBe('N/A');
  });
});

// ==================================================================
// mapToCalendarEvent
// ==================================================================
describe('mapToCalendarEvent', () => {
  it('should map a timed event correctly', () => {
    const result = mapToCalendarEvent(timedCalendarEvent);
    expect(result.sourceId).toBe('evt-timed-001');
    expect(result.title).toBe('Loose, Soft, and Elastic Energies with Jeffrey Wong');
    expect(result.start).toBe('2026-03-07T19:00:00Z');
    expect(result.end).toBe('2026-03-07T20:30:00Z');
    expect(result.location).toBe('Zoom - Online');
    expect(result.googleMapsUrl).toContain('Zoom%20-%20Online');
    expect(result.googleCalEventLink).toBe('https://www.google.com/calendar/event?eid=abc123');
    expect(result.description).toContain('Join us LIVE');
    expect(result.status).toBe('listed');
    expect(result.kind).toBe('calendar-sourced');
  });

  it('should map an all-day event and adjust end date', () => {
    const result = mapToCalendarEvent(allDayCalendarEvent);
    expect(result.sourceId).toBe('evt-allday-001');
    expect(result.title).toBe('Annual ILC Retreat 2026');
    expect(result.start).toBe('2026-06-15');
    // End date 2026-06-18 should be adjusted to 2026-06-17.
    expect(result.end).toBe('2026-06-17');
    expect(result.location).toBe('ILC Center, Kuala Lumpur, Malaysia');
    expect(result.googleMapsUrl).toContain('ILC%20Center');
    expect(result.status).toBe('listed');
    expect(result.kind).toBe('calendar-sourced');
  });

  it('should handle missing location with empty googleMapsUrl', () => {
    const result = mapToCalendarEvent(noLocationEvent);
    expect(result.location).toBe('');
    expect(result.googleMapsUrl).toBe('');
  });

  it('should default title to "No Title" when summary is empty', () => {
    const result = mapToCalendarEvent(noSummaryEvent);
    expect(result.title).toBe('No Title');
  });

  it('should handle missing htmlLink gracefully', () => {
    const result = mapToCalendarEvent(noLocationEvent);
    expect(result.googleCalEventLink).toBe('');
  });

  it('should not set lastUpdated (managed by sync logic)', () => {
    const result = mapToCalendarEvent(timedCalendarEvent);
    expect(result.lastUpdated).toBeUndefined();
  });
});

// ==================================================================
// processSquarespaceHtml
// ==================================================================
describe('processSquarespaceHtml', () => {
  const baseUrl = 'https://www.iliqchuan.com';

  it('should return empty string for empty input', () => {
    expect(processSquarespaceHtml('', baseUrl)).toBe('');
  });

  it('should convert protocol-relative src URLs to https', () => {
    const html = '<img src="//cdn.sqsp.com/image.jpg">';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain('src="https://cdn.sqsp.com/image.jpg"');
    expect(result).not.toContain('src="//');
  });

  it('should convert protocol-relative href URLs to https', () => {
    const html = '<a href="//example.com/page">Link</a>';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain('href="https://example.com/page"');
  });

  it('should resolve relative src URLs using baseUrl', () => {
    const html = '<img src="/images/photo.jpg">';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain(`src="${baseUrl}/images/photo.jpg"`);
  });

  it('should resolve relative href URLs using baseUrl', () => {
    const html = '<a href="/about">About</a>';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain(`href="${baseUrl}/about"`);
  });

  it('should replace data-src with src on images', () => {
    const html = '<img src="/placeholder.jpg" data-src="https://cdn.sqsp.com/real.jpg">';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain('src="https://cdn.sqsp.com/real.jpg?format=1000w"');
    expect(result).not.toContain('data-src');
    expect(result).not.toContain('placeholder.jpg');
  });

  it('should not add format parameter if already present in data-src', () => {
    const html = '<img data-src="https://cdn.sqsp.com/img.jpg?format=2500w">';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain('src="https://cdn.sqsp.com/img.jpg?format=2500w"');
    // Should not have double format params.
    expect(result).not.toContain('format=1000w');
  });

  it('should convert data-srcset to srcset', () => {
    const html = '<img srcset="/old.jpg" data-srcset="https://cdn.sqsp.com/img.jpg 1000w">';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain('srcset="https://cdn.sqsp.com/img.jpg 1000w"');
    expect(result).not.toContain('data-srcset');
  });

  it('should strip "loading" from image class attributes', () => {
    const html = '<img class="thumb-image loading" src="/img.jpg">';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).not.toContain('loading');
  });

  it('should convert Squarespace video wrapper divs to iframe embeds', () => {
    const html = '<div class="sqs-video-wrapper" data-html="&lt;iframe src=&quot;https://youtube.com/embed/xyz&quot;&gt;&lt;/iframe&gt;"></div>';
    const result = processSquarespaceHtml(html, baseUrl);
    expect(result).toContain('class="ilc-video-container"');
    expect(result).toContain('<iframe src="https://youtube.com/embed/xyz"></iframe>');
    expect(result).not.toContain('sqs-video-wrapper');
  });

  it('should handle baseUrl with trailing slash', () => {
    const html = '<img src="/photo.jpg">';
    const result = processSquarespaceHtml(html, 'https://www.iliqchuan.com/');
    expect(result).toContain('src="https://www.iliqchuan.com/photo.jpg"');
    // Should not have double slash.
    expect(result).not.toContain('.com//');
  });
});

// ==================================================================
// cleanAssetUrl
// ==================================================================
describe('cleanAssetUrl', () => {
  const baseUrl = 'https://www.iliqchuan.com';

  it('should return an absolute URL unchanged', () => {
    expect(cleanAssetUrl('https://cdn.sqsp.com/img.jpg', baseUrl)).toBe('https://cdn.sqsp.com/img.jpg');
  });

  it('should prepend baseUrl to a relative path', () => {
    expect(cleanAssetUrl('/images/photo.jpg', baseUrl)).toBe('https://www.iliqchuan.com/images/photo.jpg');
  });

  it('should return empty string for "undefined"', () => {
    expect(cleanAssetUrl('undefined', baseUrl)).toBe('');
  });

  it('should return empty string for "null"', () => {
    expect(cleanAssetUrl('null', baseUrl)).toBe('');
  });

  it('should return empty string for URLs containing no-image.png', () => {
    expect(cleanAssetUrl('https://cdn/no-image.png', baseUrl)).toBe('');
  });

  it('should return empty string for URLs ending with /', () => {
    expect(cleanAssetUrl('https://cdn.sqsp.com/static/image/', baseUrl)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(cleanAssetUrl(undefined, baseUrl)).toBe('');
  });

  it('should return empty string for empty string input', () => {
    expect(cleanAssetUrl('', baseUrl)).toBe('');
  });

  it('should trim whitespace', () => {
    expect(cleanAssetUrl('  https://cdn.sqsp.com/img.jpg  ', baseUrl)).toBe('https://cdn.sqsp.com/img.jpg');
  });
});

// ==================================================================
// mapToCachedBlogPost
// ==================================================================
describe('mapToCachedBlogPost', () => {
  it('should map a standard blog item to CachedBlogPost', () => {
    const result = mapToCachedBlogPost(memberBlogItem, squarespaceBaseUrl);
    expect(result.id).toBe('69a3367811eb915ea8b8bfc6');
    expect(result.urlId).toBe('investing-in-loss');
    expect(result.title).toBe('Investing in Loss');
    expect(result.publishOn).toBe(1772305190049);
    expect(result.addedOn).toBe(1772305190049);
    expect(result.categories).toEqual(['Community']);
    expect(result.tags).toEqual(['Blog', 'Members']);
    expect(result.author).toBe('Yen Lee Chin');
    expect(result.assetUrl).toBe('https://static1.squarespace.com/static/6779aa49/image.jpg');
  });

  it('should set kind to squarespace', () => {
    const result = mapToCachedBlogPost(memberBlogItem, squarespaceBaseUrl);
    expect(result.kind).toBe('squarespace');
  });

  it('should not set lastUpdated (managed by sync logic)', () => {
    const result = mapToCachedBlogPost(memberBlogItem, squarespaceBaseUrl);
    expect(result.lastUpdated).toBeUndefined();
  });

  it('should process HTML in excerpt and body', () => {
    const result = mapToCachedBlogPost(blogItemWithProtocolRelativeUrls, squarespaceBaseUrl);
    // Protocol-relative src should be converted to https.
    expect(result.body).not.toContain('src="//');
    expect(result.body).toContain('src="https://cdn.sqsp.com/real-image.jpg');
    // href should also be fixed.
    expect(result.body).toContain('href="https://www.example.com/link"');
  });

  it('should convert video embeds in body', () => {
    const result = mapToCachedBlogPost(blogItemWithVideoEmbed, squarespaceBaseUrl);
    expect(result.body).toContain('ilc-video-container');
    expect(result.body).toContain('<iframe src="https://www.youtube.com/embed/abc"></iframe>');
  });

  it('should resolve relative asset URLs', () => {
    const result = mapToCachedBlogPost(blogItemWithRelativeAssetUrl, squarespaceBaseUrl);
    expect(result.assetUrl).toBe('https://www.iliqchuan.com/images/local-photo.jpg');
  });

  it('should clean bad asset URLs to empty string', () => {
    const result = mapToCachedBlogPost(blogItemWithBadAssetUrl, squarespaceBaseUrl);
    expect(result.assetUrl).toBe('');
  });

  it('should handle missing optional fields gracefully', () => {
    const minimal = {
      id: 'min-001',
      urlId: 'minimal-post',
      title: 'Minimal',
    };
    const result = mapToCachedBlogPost(minimal, squarespaceBaseUrl);
    expect(result.id).toBe('min-001');
    expect(result.excerpt).toBe('');
    expect(result.body).toBe('');
    expect(result.assetUrl).toBe('');
    expect(result.categories).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.author).toBe('');
    expect(result.publishOn).toBe(0);
    expect(result.addedOn).toBe(0);
    expect(result.kind).toBe('squarespace');
  });

  it('should use content field as fallback when body is missing', () => {
    const item = {
      id: 'fallback-001',
      urlId: 'fallback',
      title: 'Fallback content',
      content: '<p>Fallback body text</p>',
    };
    const result = mapToCachedBlogPost(item, squarespaceBaseUrl);
    expect(result.body).toContain('Fallback body text');
  });

  it('should resolve relative links in body using baseUrl', () => {
    const result = mapToCachedBlogPost(blogItemWithRelativeAssetUrl, squarespaceBaseUrl);
    expect(result.body).toContain(`href="${squarespaceBaseUrl}/about"`);
  });
});

// ==================================================================
// contentChanged
// ==================================================================
describe('contentChanged', () => {
  it('should return false when content is identical', () => {
    const existing = { title: 'Hello', body: 'World', lastUpdated: '2026-01-01T00:00:00Z' };
    const incoming = { title: 'Hello', body: 'World' };
    expect(contentChanged(existing, incoming)).toBe(false);
  });

  it('should return true when a field differs', () => {
    const existing = { title: 'Hello', body: 'World' };
    const incoming = { title: 'Hello', body: 'Changed!' };
    expect(contentChanged(existing, incoming)).toBe(true);
  });

  it('should return true when incoming has a field not in existing', () => {
    const existing = { title: 'Hello' };
    const incoming = { title: 'Hello', kind: 'squarespace' };
    expect(contentChanged(existing, incoming)).toBe(true);
  });

  it('should ignore lastUpdated differences', () => {
    const existing = { title: 'Hello', lastUpdated: '2026-01-01T00:00:00Z' };
    const incoming = { title: 'Hello', lastUpdated: '2026-02-01T00:00:00Z' };
    expect(contentChanged(existing, incoming)).toBe(false);
  });

  it('should detect array changes', () => {
    const existing = { tags: ['a', 'b'] };
    const incoming = { tags: ['a', 'c'] };
    expect(contentChanged(existing, incoming)).toBe(true);
  });

  it('should detect array length changes', () => {
    const existing = { categories: ['one'] };
    const incoming = { categories: ['one', 'two'] };
    expect(contentChanged(existing, incoming)).toBe(true);
  });

  it('should return false for identical arrays', () => {
    const existing = { tags: ['a', 'b'], categories: ['x'] };
    const incoming = { tags: ['a', 'b'], categories: ['x'] };
    expect(contentChanged(existing, incoming)).toBe(false);
  });

  it('should detect number changes', () => {
    const existing = { publishOn: 1000 };
    const incoming = { publishOn: 2000 };
    expect(contentChanged(existing, incoming)).toBe(true);
  });
});
