import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageVodVideoPageComponent } from './manage-vod-video-page';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { VodAccessListComponent } from '../vod-access-list/vod-access-list';
import { ManageVodEditVideoComponent } from '../manage-vod-edit-video/manage-vod-edit-video';
import {
  initVideoItem,
  VideoItem,
  VideoSeries,
  VodAccessTier,
  VodStatus,
} from '../../../functions/src/data-model/vod';

@Component({
  selector: 'app-vod-access-list',
  template: 'ACCESS:{{ video()?.docId }}:{{ parentSeries()?.seriesId }}',
})
class StubAccessListComponent {
  video = input<VideoItem | null>(null);
  series = input<VideoSeries | null>(null);
  parentSeries = input<VideoSeries | null>(null);
}

@Component({ selector: 'app-manage-vod-edit-video', template: 'DETAILS:{{ videoId() }}' })
class StubEditVideoComponent {
  videoId = input.required<string>();
}

describe('ManageVodVideoPageComponent', () => {
  let fixture: ComponentFixture<ManageVodVideoPageComponent>;
  let component: ManageVodVideoPageComponent;
  let videoIdSignal: ReturnType<typeof signal<string>>;
  let tabSignal: ReturnType<typeof signal<string>>;
  let mockDataService: {
    videos: { get: (id: string) => VideoItem | undefined; loading: ReturnType<typeof signal<boolean>> };
    getVideoSeriesList: ReturnType<typeof vi.fn>;
    getVideoById: ReturnType<typeof vi.fn>;
  };

  const standalone: VideoItem = {
    ...initVideoItem(),
    docId: 'v1',
    title: 'Solo Drill',
    description: 'A standalone drill.',
    vodStatus: VodStatus.Ready,
    accessTier: VodAccessTier.MembersOnly,
    accessTiers: [VodAccessTier.MembersOnly],
    isPublished: true,
    durationSeconds: 3900,
    tags: ['drill'],
  };
  const episode: VideoItem = {
    ...initVideoItem(),
    docId: 'ep2',
    title: 'Spacing Part 2',
    seriesId: 'series_spacing',
    vodStatus: VodStatus.Ready,
    isPublished: true,
  };
  const series: VideoSeries = {
    seriesId: 'series_spacing',
    title: 'Understanding Spacing',
    description: '',
    tags: [],
    videoCount: 2,
    totalDurationSeconds: 0,
    videos: [{ ...episode, docId: 'ep1', title: 'Spacing Part 1' }, episode],
    accessTiers: [VodAccessTier.Public],
    priceCents: 2500,
  };

  beforeEach(async () => {
    videoIdSignal = signal('v1');
    tabSignal = signal('overview');
    const all = [standalone, episode];
    mockDataService = {
      videos: { get: (id: string) => all.find((v) => v.docId === id), loading: signal(false) },
      getVideoSeriesList: vi.fn().mockReturnValue([series]),
      getVideoById: vi.fn().mockResolvedValue(null),
    };
    const mockRoutingService = {
      signals: {
        [Views.ManageVodVideo]: { pathVars: { videoId: videoIdSignal }, urlParams: { tab: tabSignal } },
      },
      hrefForView: vi.fn((view: string, pathVars?: Record<string, string>, urlParams?: Record<string, string>) => {
        const id = pathVars?.['videoId'] ?? pathVars?.['seriesId'] ?? '';
        return `/${view}/${id}?tab=${urlParams?.['tab'] ?? ''}`;
      }),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVodVideoPageComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    })
      .overrideComponent(ManageVodVideoPageComponent, {
        remove: { imports: [VodAccessListComponent, ManageVodEditVideoComponent] },
        add: { imports: [StubAccessListComponent, StubEditVideoComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ManageVodVideoPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('renders the three tabs with Overview active by default', () => {
    const tabs = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.pill-tab'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Overview', 'Who has access', 'Details']);
    expect(tabs[0].classList.contains('active')).toBe(true);
  });

  it('shows a standalone video overview with its own access settings', () => {
    expect(text()).toContain('Free: Members');
    expect(text()).toContain('1h 5m');
    expect(text()).toContain('A standalone drill.');
    expect(component.series()).toBeNull();
  });

  it('offers only a standard primary Watch button on the overview (tabs cover the rest)', () => {
    const actions = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('.overview-actions a'),
    );
    expect(actions.length).toBe(1);
    expect(actions[0].classList).toContain('button');
    expect(actions[0].classList).toContain('primary-button');
    expect(actions[0].textContent).toContain('Watch');
  });

  it('syncs the selected tab to the URL', () => {
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.pill-tab');
    tabs[1].click();
    expect(tabSignal()).toBe('access');
  });

  it('renders the access list for the video on the access tab', () => {
    tabSignal.set('access');
    fixture.detectChanges();
    expect(text()).toContain('ACCESS:v1');
  });

  it('renders the edit form on the details tab', () => {
    tabSignal.set('details');
    fixture.detectChanges();
    expect(text()).toContain('DETAILS:v1');
  });

  it('falls back to overview for an unknown tab value', () => {
    tabSignal.set('bogus');
    expect(component.activeTab()).toBe('overview');
  });

  it('shows series membership and series-wide access for an episode', () => {
    videoIdSignal.set('ep2');
    fixture.detectChanges();
    expect(component.partNumber()).toBe(2);
    expect(text()).toContain('Part 2 of 2');
    expect(text()).toContain('Free: Public');
    expect(text()).toContain('Series bundle $25.00');
    const seriesLink = (fixture.nativeElement as HTMLElement).querySelector('dd a.inline-link-button');
    expect(seriesLink?.getAttribute('href')).toBe(`/${Views.ManageVodSeries}/series_spacing?tab=overview`);
  });

  it('passes the resolved parent series to the access list for an episode', () => {
    videoIdSignal.set('ep2');
    tabSignal.set('access');
    fixture.detectChanges();
    expect(text()).toContain('ACCESS:ep2:series_spacing');
  });

  it('shows a not-found state when the video cannot be loaded', async () => {
    videoIdSignal.set('missing');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(mockDataService.getVideoById).toHaveBeenCalledWith('missing');
    expect(text()).toContain('Video not found');
  });
});
