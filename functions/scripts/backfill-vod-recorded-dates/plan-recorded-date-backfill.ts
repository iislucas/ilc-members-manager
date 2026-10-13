/* plan-recorded-date-backfill.ts
 *
 * Pure planning logic for backfill-vod-recorded-dates.ts (same directory), kept
 * separate (and side-effect free) so its safety properties are unit-tested:
 *   - never overwrites an existing `recordedDate` unless `force` is set;
 *   - idempotent: once the planned updates are applied, re-planning yields none.
 */

/** Minimal view of a video needed for planning. */
export interface RecordedDateVideo {
  docId: string;
  title: string;
  recordedDate: string;
  seriesId?: string;
  forVodPageId?: string;
}

/** Date for every video in a series (Vimeo On Demand page id). */
export interface SeriesRecordedDate {
  seriesId: string;
  recordedDate: string; // YYYY-MM-DD or YYYY-MM
  sourceTitle: string;
}

/** Date for a single video; overrides any series-level date. */
export interface VideoRecordedDate {
  docId: string;
  recordedDate: string;
  title: string;
  evidence: string;
}

export interface RecordedDateUpdate {
  docId: string;
  title: string;
  recordedDate: string;
  source: string;
}

export interface RecordedDatePlan {
  updates: RecordedDateUpdate[];
  /** Videos whose existing date differs from the proposal (left untouched). */
  skipped: Array<{ docId: string; title: string; existing: string; proposed: string }>;
  /** Videos where per-video evidence replaced the series-level date. */
  overrides: Array<{ docId: string; title: string; seriesDate: string; videoDate: string }>;
  unmatchedSeries: SeriesRecordedDate[];
  unknownVideos: VideoRecordedDate[];
}

export function planRecordedDateBackfill(
  videos: RecordedDateVideo[],
  seriesDates: SeriesRecordedDate[],
  videoDates: VideoRecordedDate[],
  options: { force?: boolean } = {},
): RecordedDatePlan {
  const plan: RecordedDatePlan = { updates: [], skipped: [], overrides: [], unmatchedSeries: [], unknownVideos: [] };
  const targets = new Map<string, { date: string; source: string }>();

  for (const entry of seriesDates) {
    const matches = videos.filter((v) => v.seriesId === entry.seriesId || v.forVodPageId === entry.seriesId);
    if (matches.length === 0) plan.unmatchedSeries.push(entry);
    for (const v of matches) {
      targets.set(v.docId, { date: entry.recordedDate, source: `seminar list: ${entry.sourceTitle}` });
    }
  }

  const byId = new Map(videos.map((v) => [v.docId, v]));
  for (const vd of videoDates) {
    const v = byId.get(vd.docId);
    if (!v) {
      plan.unknownVideos.push(vd);
      continue;
    }
    const prior = targets.get(vd.docId);
    if (prior && prior.date !== vd.recordedDate) {
      plan.overrides.push({ docId: vd.docId, title: v.title, seriesDate: prior.date, videoDate: vd.recordedDate });
    }
    targets.set(vd.docId, { date: vd.recordedDate, source: `description: "${vd.evidence}"` });
  }

  for (const [docId, { date, source }] of targets) {
    const v = byId.get(docId)!;
    if (v.recordedDate === date) continue; // already correct → no write (idempotence)
    if (v.recordedDate && !options.force) {
      plan.skipped.push({ docId, title: v.title, existing: v.recordedDate, proposed: date });
      continue;
    }
    plan.updates.push({ docId, title: v.title, recordedDate: date, source });
  }
  plan.updates.sort((a, b) => a.recordedDate.localeCompare(b.recordedDate) || a.docId.localeCompare(b.docId));
  return plan;
}
