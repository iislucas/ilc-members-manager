import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageVodSeriesPageComponent } from './manage-vod-series-page';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { VodAccessListComponent } from '../vod-access-list/vod-access-list';
import { ManageVodEditSeriesComponent } from '../manage-vod-edit-series/manage-vod-edit-series';
import {
  initVideoItem,
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
} from '../../../functions/src/data-model/vod';

@Component({ selector: 'app-vod-access-list', template: 'ACCESS:{{ series()?.seriesId }}' })
class StubAccessListComponent {
  video = input<VideoItem | null>(null);
  series = input<VideoSeries | null>(null);
}

@Component({ selector: 'app-manage-vod-edit-series', template: 'DETAILS:{{ seriesId() }}' })
class StubEditSeriesComponent {
  seriesId = input.required<string>();
}

describe('ManageVodSeriesPageComponent', () => {
  let fixture: ComponentFixture<ManageVodSeriesPageComponent>;
  let component: ManageVodSeriesPageComponent;
  let seriesIdSignal: ReturnType<typeof signal<string>>;
  let tabSignal: ReturnType<typeof signal<string>>;
  let loading: ReturnType<typeof signal<boolean>>;

  const ep1: VideoItem = {
    ...initVideoItem(),
    docId: 'ep1',
    title: 'Spacing Part 1',
    vodStatus: VodStatus.Ready,
    isPublished: true,
    durationSeconds: 1200,
    thumbnailUrl: 'https://example.com/ep1.jpg',
  };
  const ep2: VideoItem = {
    ...initVideoItem(),
    docId: 'ep2',
    title: 'Spacing Part 2',
    vodStatus: VodStatus.Transcoding,
    isPublished: false,
    durationSeconds: 600,
  };
  const series: VideoSeries = {
    seriesId: 'series_spacing',
    title: 'Understanding Spacing',
    description: 'All about spacing.',
    tags: [],
    videoCount: 2,
    totalDurationSeconds: 1800,
    videos: [ep1, ep2],
    accessTiers: [VodAccessTier.InstructorsOnly, VodAccessTier.ClassVideoSubscribers],
    priceCents: 4999,
    isPublished: true,
  };

  beforeEach(async () => {
    seriesIdSignal = signal('series_spacing');
    tabSignal = signal('overview');
    loading = signal(false);
    const mockRoutingService = {
      signals: {
        [Views.ManageVodSeries]: { pathVars: { seriesId: seriesIdSignal }, urlParams: { tab: tabSignal } },
      },
      hrefForView: vi.fn((view: string, pathVars?: Record<string, string>, urlParams?: Record<string, string>) => {
        const id = pathVars?.['videoId'] ?? pathVars?.['seriesId'] ?? '';
        return `/${view}/${id}?tab=${urlParams?.['tab'] ?? ''}`;
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVodSeriesPageComponent],
      providers: [
        {
          provide: DataManagerService,
          useValue: { videos: { loading }, getVideoSeriesList: vi.fn().mockReturnValue([series]) },
        },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    })
      .overrideComponent(ManageVodSeriesPageComponent, {
        remove: { imports: [VodAccessListComponent, ManageVodEditSeriesComponent] },
        add: { imports: [StubAccessListComponent, StubEditSeriesComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ManageVodSeriesPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('shows a series overview with access settings and a poster fallback', () => {
    expect(el().textContent).toContain('Free: Instructors');
    expect(el().textContent).toContain('Class subscribers');
    expect(el().textContent).toContain('Bundle $49.99');
    expect(el().textContent).toContain('30m');
    expect(component.thumbnailUrl()).toBe('https://example.com/ep1.jpg');
  });

  it('lists episodes linking to each video admin page, flagging unready/unlisted ones', () => {
    const rows = Array.from(el().querySelectorAll<HTMLAnchorElement>('a.episode-row'));
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('href')).toBe(`/${Views.ManageVodVideo}/ep1?tab=overview`);
    expect(rows[1].textContent).toContain('transcoding');
    expect(rows[1].textContent).toContain('Unlisted');
  });

  it('renders the access list for the series on the access tab', () => {
    tabSignal.set('access');
    fixture.detectChanges();
    expect(el().textContent).toContain('ACCESS:series_spacing');
  });

  it('renders the edit form on the details tab', () => {
    tabSignal.set('details');
    fixture.detectChanges();
    expect(el().textContent).toContain('DETAILS:series_spacing');
  });

  it('shows loading, then not-found, for an unknown series', () => {
    seriesIdSignal.set('missing');
    loading.set(true);
    fixture.detectChanges();
    expect(el().querySelector('app-spinner')).toBeTruthy();
    loading.set(false);
    fixture.detectChanges();
    expect(el().textContent).toContain('Series not found');
  });
});
