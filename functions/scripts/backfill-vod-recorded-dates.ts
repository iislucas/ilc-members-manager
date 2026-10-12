/* backfill-vod-recorded-dates.ts
 *
 * Backfills `recordedDate` on VOD videos from the curated "List of seminars"
 * document (supplied by the community, Oct 2026). The Vimeo import
 * (scripts/vimeo-migrate-to-gcs.ts) never set `recordedDate`: Vimeo only
 * exposes upload/modified timestamps, not when a seminar was recorded.
 *
 * Each entry maps a VOD series (the Vimeo On Demand page id, stored on videos
 * as `seriesId` / legacy `forVodPageId`) to its recording date. Every video in
 * the series (episodes, trailers, previews) gets the date. Dates are
 * `YYYY-MM-DD`, or `YYYY-MM` when the source only gives the month.
 *
 * A second source, data/vod-recorded-dates-from-descriptions.json, holds
 * per-video dates mined from Vimeo titles/descriptions (mostly Class Library
 * videos); those win over the series-level list when both apply.
 *
 * Videos that already have a `recordedDate` are left alone unless --force.
 *
 * Usage:
 *   cd functions
 *   pnpm exec ts-node scripts/backfill-vod-recorded-dates.ts            # dry run
 *   pnpm exec ts-node scripts/backfill-vod-recorded-dates.ts --commit   # write
 *   pnpm exec ts-node scripts/backfill-vod-recorded-dates.ts --commit --force
 */

import { createActionContext, listVideos, updateVideo } from '../src/actions';
import {
  SeriesRecordedDate,
  VideoRecordedDate,
  planRecordedDateBackfill,
} from '../src/vod/plan-recorded-date-backfill';

const SEMINAR_DATES: SeriesRecordedDate[] = [
  { seriesId: '106038', recordedDate: '2004-10-09', sourceTitle: 'Iliqchuan Chi-Kung for Health. Chuang Yen Monastery' },
  { seriesId: '36154', recordedDate: '2015-04-14', sourceTitle: 'Three Day Retreat' },
  { seriesId: '44157', recordedDate: '2005-10-23', sourceTitle: 'I Liq Chuan - Chin Na. A Flowing Process.' },
  // Not in the seminar list; its Vimeo description says "Recorded in Payson, Arizona April 2022."
  { seriesId: '400110', recordedDate: '2022-04', sourceTitle: 'Zhong Xin Dao I Liq Chuan Chin Na vol. 3' },
  { seriesId: '109439', recordedDate: '2016-03-05', sourceTitle: 'Knowing the Moment. Point of Contact' },
  // List says 2022-09-19 (the Vimeo upload day); the VOD URL is /ondemand/sundayclass91822.
  { seriesId: '405659', recordedDate: '2022-09-18', sourceTitle: 'Structure, Relaxation, and Energy' },
  // List says 2023-03-27 (upload day); descriptions say "Sunday Class March 26, 2023".
  { seriesId: '427797', recordedDate: '2023-03-26', sourceTitle: 'One Point of Rotation' },
  // List says 2023-05-28 (upload day); URL is /ondemand/sanda52723 and the trailer says 5/27/23.
  { seriesId: '434192', recordedDate: '2023-05-27', sourceTitle: 'San Da - Free Sparring with Grandmaster Sam F.S. Chin' },
  { seriesId: '446953', recordedDate: '2023-10-09', sourceTitle: 'Breaking Bridge' },
  { seriesId: '449411', recordedDate: '2023-11-05', sourceTitle: 'Phoenix Eye' },
  { seriesId: '469846', recordedDate: '2024-07-22', sourceTitle: 'How to Gain Inner Strength' },
  { seriesId: '475553', recordedDate: '2024-11-05', sourceTitle: 'The Foundation of Inner Power' },
  { seriesId: '484740', recordedDate: '2025-05-03', sourceTitle: 'Catching the Moment' },
  { seriesId: '491516', recordedDate: '2025-09-06', sourceTitle: 'Understanding Spacing - A Key to Gaining Optimal Advantage' },
  { seriesId: '504000', recordedDate: '2026-05-02', sourceTitle: 'Complementary Energies' },
  { seriesId: '46391', recordedDate: '2015-08-12', sourceTitle: '21 Form Instructional Video' },
  { seriesId: '441650', recordedDate: '2023-08-13', sourceTitle: '21 Form - Part 1' },
  { seriesId: '444199', recordedDate: '2023-09-10', sourceTitle: '21 Form - Part 2' },
  { seriesId: '35947', recordedDate: '2008-05-18', sourceTitle: 'Refinement Of I Liq Chuan Basic Exercises - Grading Criterion For Instructors' },
  { seriesId: '440264', recordedDate: '2023-07-29', sourceTitle: 'Basic Exercise 21 Form Class' },
  { seriesId: '453647', recordedDate: '2023-12-16', sourceTitle: 'Refinement of Basic Exercises (21 form and Partner Training)' },
  { seriesId: '485500', recordedDate: '2025-05-17', sourceTitle: 'Functions of Basic Exercises' },
  { seriesId: '44153', recordedDate: '2002-11-24', sourceTitle: 'Sticky and Spinning Hands – Upper Hands Process' },
  { seriesId: '38717', recordedDate: '2003-03-16', sourceTitle: 'Sticky Hands - Introduction to Lower Hand Process' },
  { seriesId: '445134', recordedDate: '2023-09-18', sourceTitle: 'Spinning Hands with Applications' },
  { seriesId: '482821', recordedDate: '2025-03-22', sourceTitle: 'Light and Heavy Spinning Hands' },
  { seriesId: '34963', recordedDate: '2015-03-30', sourceTitle: 'San Da Vol. 1 - Free Fight Training Workshop (Introduction to San Shou)' },
  { seriesId: '34976', recordedDate: '2009-11', sourceTitle: 'San Da Vol. 2 - Free Fight Training Workshop' },
  { seriesId: '35957', recordedDate: '2015-04-12', sourceTitle: 'San Da Vol. 3 - Applications of 5 Elements' },
  { seriesId: '35959', recordedDate: '2010-11', sourceTitle: 'San Da Vol. 4 - Throwing Hands' },
  { seriesId: '35962', recordedDate: '2015-04-13', sourceTitle: 'San Da Vol. 5 - Timing and Spacing' },
  { seriesId: '32159', recordedDate: '2011-11', sourceTitle: 'San Da Vol. 6 - Kicking' },
  { seriesId: '35951', recordedDate: '2011-11-01', sourceTitle: 'Meet and Match' },
  { seriesId: '35953', recordedDate: '2009-05', sourceTitle: 'Introduction to Phoenix Eye' },
  { seriesId: '36242', recordedDate: '2015-04-15', sourceTitle: 'Butterfly Form - Application and Fajing. Instructional DVD' },
  { seriesId: '36271', recordedDate: '2015-04-15', sourceTitle: 'Butterfly Form - Sequence (full)' },
  { seriesId: '36074', recordedDate: '2010-11', sourceTitle: 'Five Elements' },
  { seriesId: '36412', recordedDate: '2015-04-17', sourceTitle: 'Structure and Energy' },
  { seriesId: '36073', recordedDate: '2011-05', sourceTitle: 'Spinning Hands Process' },
  { seriesId: '36182', recordedDate: '2010-05', sourceTitle: 'Tai Chi Point and Intro to Fajin' },
  { seriesId: '76455', recordedDate: '2009-05', sourceTitle: 'Finding The Center and Sticky Hands' },
  { seriesId: '143555', recordedDate: '2009-05', sourceTitle: 'St. Petersburg Workshop' },
];

/**
 * Per-video dates mined from Vimeo titles/descriptions (e.g. "Conducted on 4/26",
 * "Recorded ... April 2022", "MABA Aug 19 2017"). Where only month/day is given,
 * the year was inferred from the Vimeo upload date (uploads were within days).
 * These take precedence over the series-level seminar list dates.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VIDEO_DATES: VideoRecordedDate[] = require('./data/vod-recorded-dates-from-descriptions.json');

async function main() {
  const commit = process.argv.includes('--commit');
  const force = process.argv.includes('--force');
  const ctx = createActionContext({ dryRun: !commit, logger: () => undefined });

  const videos = await listVideos(ctx, { limitCount: 5000 });
  console.log(`Loaded ${videos.length} videos. Mode: ${commit ? 'COMMIT' : 'DRY RUN'}${force ? ' (force)' : ''}\n`);

  const plan = planRecordedDateBackfill(videos, SEMINAR_DATES, VIDEO_DATES, { force });
  for (const s of plan.unmatchedSeries) console.warn(`⚠ No videos for series ${s.seriesId} ("${s.sourceTitle}")`);
  for (const v of plan.unknownVideos) console.warn(`⚠ Unknown video ${v.docId} ("${v.title}")`);
  for (const o of plan.overrides) {
    console.log(`  note ${o.docId} "${o.title}": description ${o.videoDate} overrides series ${o.seriesDate}`);
  }
  for (const s of plan.skipped) {
    console.log(`  skip ${s.docId} "${s.title}" (already ${s.existing}; proposed ${s.proposed})`);
  }

  let updated = 0;
  for (const u of plan.updates) {
    // updateVideo merges only { recordedDate, lastUpdated } into the doc.
    const res = await updateVideo(ctx, u.docId, { recordedDate: u.recordedDate });
    if (!res.success) {
      console.error(`  ✗ ${u.docId}: ${res.error}`);
      continue;
    }
    console.log(`  ${commit ? '✓' : '~'} ${u.recordedDate.padEnd(10)} ${u.docId} "${u.title}" ← ${u.source}`);
    updated++;
  }
  console.log(`\n${commit ? 'Updated' : 'Would update'} ${updated} video(s); skipped ${plan.skipped.length} with existing dates.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
