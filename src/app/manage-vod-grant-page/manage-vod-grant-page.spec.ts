import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input, output, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManageVodGrantPageComponent } from './manage-vod-grant-page';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { GrantVodFormComponent, GrantVodResult } from '../grant-vod-form/grant-vod-form';
import { VideoItem, VideoSeries, initVideoItem } from '../../../functions/src/data-model/vod';

@Component({
  selector: 'app-grant-vod-form',
  template: 'FORM:{{ video()?.docId }}:{{ series()?.seriesId }}:{{ parentSeries()?.seriesId }}:{{ cancelHref() }}',
})
class StubGrantFormComponent {
  video = input<VideoItem | null>(null);
  series = input<VideoSeries | null>(null);
  parentSeries = input<VideoSeries | null>(null);
  cancelHref = input.required<string>();
  granted = output<GrantVodResult>();
}

describe('ManageVodGrantPageComponent', () => {
  let fixture: ComponentFixture<ManageVodGrantPageComponent>;
  let component: ManageVodGrantPageComponent;
  let view: ReturnType<typeof signal<Views>>;

  const episode: VideoItem = { ...initVideoItem(), docId: 'ep1', title: 'Part 1', seriesId: 'series_a' };
  const series: VideoSeries = {
    seriesId: 'series_a',
    title: 'Series A',
    description: '',
    tags: [],
    videoCount: 2,
    totalDurationSeconds: 0,
    videos: [episode, { ...episode, docId: 'ep2' }],
  };

  beforeEach(async () => {
    view = signal<Views>(Views.ManageVodVideoGrant);
    await TestBed.configureTestingModule({
      imports: [ManageVodGrantPageComponent],
      providers: [
        {
          provide: DataManagerService,
          useValue: {
            videos: { get: (id: string) => (id === 'ep1' ? episode : undefined), loading: signal(false) },
            getVideoSeriesList: () => [series],
            getVideoById: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: RoutingService,
          useValue: {
            matchedPatternId: view,
            signals: {
              [Views.ManageVodVideoGrant]: { pathVars: { videoId: signal('ep1') } },
              [Views.ManageVodSeriesGrant]: { pathVars: { seriesId: signal('series_a') } },
            },
            hrefForView: vi.fn((v: string, pathVars: Record<string, string> = {}, urlParams: Record<string, string> = {}) =>
              `/${v}/${Object.values(pathVars).join('/')}?tab=${urlParams['tab'] ?? ''}`,
            ),
          },
        },
      ],
    })
      .overrideComponent(ManageVodGrantPageComponent, {
        remove: { imports: [GrantVodFormComponent] },
        add: { imports: [StubGrantFormComponent] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ManageVodGrantPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  it('hosts the form for a video with its parent series, cancelling back to the video access tab', () => {
    expect(text()).toContain(`FORM:ep1::series_a:/${Views.ManageVodVideo}/ep1?tab=access`);
  });

  it('hosts the form for a series, cancelling back to the series access tab', () => {
    view.set(Views.ManageVodSeriesGrant);
    fixture.detectChanges();
    expect(text()).toContain(`FORM::series_a::/${Views.ManageVodSeries}/series_a?tab=access`);
  });

  function result(over: Partial<GrantVodResult> = {}): GrantVodResult {
    return {
      response: { success: true, grantedCount: 1, recipientEmail: 'a@b.c', notifiedInApp: false, emailSent: false },
      targetType: 'series',
      targetId: 'series_a',
      title: 'Series A',
      recipientLabel: 'a@b.c',
      notificationRequested: true,
      ...over,
    };
  }

  it('confirms the grant and links to the access list of what was granted', () => {
    component.onGranted(result());
    fixture.detectChanges();
    expect(text()).toContain('Access granted');
    const link = (fixture.nativeElement as HTMLElement).querySelector('a.primary-button');
    expect(link?.getAttribute('href')).toBe(`/${Views.ManageVodSeries}/series_a?tab=access`);
  });

  it('asks the admin to contact the recipient when no notification could be sent', () => {
    component.onGranted(result());
    fixture.detectChanges();
    expect(text()).toContain('Please contact them directly');
  });

  it('reports a silent grant and lets the admin grant to someone else', () => {
    component.onGranted(result({ notificationRequested: false }));
    fixture.detectChanges();
    expect(text()).toContain('added silently');
    component.grantAnother();
    fixture.detectChanges();
    expect(text()).toContain('FORM:');
  });
});
