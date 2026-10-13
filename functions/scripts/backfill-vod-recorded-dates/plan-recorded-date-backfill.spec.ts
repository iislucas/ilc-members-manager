import { describe, it, expect } from 'vitest';
import { planRecordedDateBackfill, RecordedDateVideo } from './plan-recorded-date-backfill';

const vid = (docId: string, extra: Partial<RecordedDateVideo> = {}): RecordedDateVideo => ({
  docId,
  title: docId,
  recordedDate: '',
  ...extra,
});

const SERIES = [{ seriesId: 's1', recordedDate: '2015-04-14', sourceTitle: 'Retreat' }];

describe('planRecordedDateBackfill', () => {
  it('dates every video in a matched series (via seriesId or legacy forVodPageId)', () => {
    const plan = planRecordedDateBackfill(
      [vid('a', { seriesId: 's1' }), vid('b', { forVodPageId: 's1' }), vid('c', { seriesId: 'other' })],
      SERIES,
      [],
    );
    expect(plan.updates.map((u) => [u.docId, u.recordedDate])).toEqual([
      ['a', '2015-04-14'],
      ['b', '2015-04-14'],
    ]);
  });

  it('never clobbers an existing different date without force', () => {
    const videos = [vid('a', { seriesId: 's1', recordedDate: '2009-11' })];
    const plan = planRecordedDateBackfill(videos, SERIES, [
      { docId: 'a', recordedDate: '2010-01-01', title: 'a', evidence: 'x' },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.skipped).toEqual([{ docId: 'a', title: 'a', existing: '2009-11', proposed: '2010-01-01' }]);

    const forced = planRecordedDateBackfill(videos, SERIES, [], { force: true });
    expect(forced.updates.map((u) => u.recordedDate)).toEqual(['2015-04-14']);
  });

  it('per-video evidence overrides the series date and is reported', () => {
    const plan = planRecordedDateBackfill([vid('a', { seriesId: 's1' })], SERIES, [
      { docId: 'a', recordedDate: '2015-04-12', title: 'a', evidence: 'Conducted on 4/12' },
    ]);
    expect(plan.updates[0].recordedDate).toBe('2015-04-12');
    expect(plan.overrides).toEqual([{ docId: 'a', title: 'a', seriesDate: '2015-04-14', videoDate: '2015-04-12' }]);
  });

  it('is idempotent: applying the plan then re-planning yields no updates', () => {
    const videos = [
      vid('a', { seriesId: 's1' }),
      vid('b', { seriesId: 's1', recordedDate: '1999-01' }),
      vid('c'),
    ];
    const videoDates = [{ docId: 'c', recordedDate: '2020-04-26', title: 'c', evidence: 'Conducted on 4/26' }];
    const first = planRecordedDateBackfill(videos, SERIES, videoDates);
    expect(first.updates.map((u) => u.docId)).toEqual(['a', 'c']);

    const applied = videos.map((v) => ({
      ...v,
      recordedDate: first.updates.find((u) => u.docId === v.docId)?.recordedDate ?? v.recordedDate,
    }));
    const second = planRecordedDateBackfill(applied, SERIES, videoDates);
    expect(second.updates).toEqual([]);
    expect(second.skipped).toEqual(first.skipped); // pre-existing data still untouched
  });

  it('reports unmatched series and unknown videos without failing', () => {
    const plan = planRecordedDateBackfill([], SERIES, [{ docId: 'zz', recordedDate: '2020-01', title: 'zz', evidence: '' }]);
    expect(plan.unmatchedSeries).toEqual(SERIES);
    expect(plan.unknownVideos.map((v) => v.docId)).toEqual(['zz']);
    expect(plan.updates).toEqual([]);
  });
});
