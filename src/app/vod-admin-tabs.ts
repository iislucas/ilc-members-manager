/* vod-admin-tabs.ts
 *
 * Shared helpers for the tabbed admin pages of a single VOD video
 * (/manage-vod/video/:videoId) and a single series (/manage-vod/series/:seriesId).
 */

export type VodAdminTab = 'overview' | 'access' | 'details';

export const VOD_ADMIN_TABS: readonly { id: VodAdminTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'access', label: 'Who has access' },
  { id: 'details', label: 'Details' },
];

/** Normalises a raw `tab` URL parameter, defaulting to the overview tab. */
export function parseVodAdminTab(raw: string | null | undefined): VodAdminTab {
  return raw === 'access' || raw === 'details' ? raw : 'overview';
}

/** Formats a duration in seconds as e.g. "1h 5m" or "42m". */
export function formatVodDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}
