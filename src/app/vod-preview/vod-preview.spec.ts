/* vod-preview.spec.ts
 *
 * Unit tests for VodPreviewComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VodPreviewComponent } from './vod-preview';
import { DataManagerService } from '../data-manager.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';
import { signal } from '@angular/core';
import { initVideoItem, VideoItem, VideoSeries } from '../../../functions/src/data-model/vod';

describe('VodPreviewComponent', () => {
  let component: VodPreviewComponent;
  let fixture: ComponentFixture<VodPreviewComponent>;

  const mockSeries: VideoSeries = {
    seriesId: 'series_winter_2026',
    title: 'Winter Intensive 2026',
    description: 'Complete 3-part winter workshop series',
    videoCount: 3,
    totalDurationSeconds: 7200,
    thumbnailUrl: 'https://images.example/series-thumb.jpg',
    recordedDate: '2026-01-20',
    tags: ['workshop', 'winter'],
    videos: [
      {
        ...initVideoItem(),
        docId: 'v_winter_ep1',
        title: 'Winter Intensive: Part 1',
        seriesId: 'series_winter_2026',
        seriesPartIndex: 1,
        durationSeconds: 2400,
        thumbnailUrl: 'https://images.example/ep1-thumb.jpg',
        recordedDate: '2026-01-20',
      },
      {
        ...initVideoItem(),
        docId: 'v_winter_ep2',
        title: 'Winter Intensive: Part 2',
        seriesId: 'series_winter_2026',
        seriesPartIndex: 2,
        durationSeconds: 2400,
        thumbnailUrl: 'https://images.example/ep2-thumb.jpg',
        recordedDate: '2026-01-21',
      },
    ],
  };

  const mockSingleVideo: VideoItem = {
    ...initVideoItem(),
    docId: 'v_spinning_single',
    title: 'Spinning Hands Fundamentals',
    description: 'Solo and partner spinning mechanics',
    durationSeconds: 3600,
    thumbnailUrl: 'https://images.example/spinning-thumb.jpg',
    recordedDate: '2026-02-15',
  };

  let mockDataService: {
    videos: {
      entries: ReturnType<typeof signal<VideoItem[]>>;
      get: ReturnType<typeof vi.fn>;
    };
    getVideoSeriesList: ReturnType<typeof vi.fn>;
  };

  let mockRoutingService: {
    hrefForView: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockDataService = {
      videos: {
        entries: signal([mockSingleVideo, ...mockSeries.videos]),
        get: vi.fn((id: string) => {
          if (id === mockSingleVideo.docId) return mockSingleVideo;
          return mockSeries.videos.find((v) => v.docId === id);
        }),
      },
      getVideoSeriesList: vi.fn().mockReturnValue([mockSeries]),
    };

    mockRoutingService = {
      hrefForView: vi.fn((view: string, params?: { videoId?: string }) => `/videos/${params?.videoId || ''}`),
    };

    await TestBed.configureTestingModule({
      imports: [VodPreviewComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VodPreviewComponent);
    component = fixture.componentInstance;
  });

  it('should resolve and render series details when videoId matches a seriesId', () => {
    fixture.componentRef.setInput('videoId', 'series_winter_2026');
    fixture.detectChanges();

    const details = component.details();
    expect(details).not.toBeNull();
    expect(details?.kind).toBe('series');
    expect(details?.title).toBe('Winter Intensive 2026');
    expect(details?.videoCount).toBe(3);
    expect(details?.durationText).toBe('2h');
    expect(details?.thumbnailUrl).toBe('https://images.example/series-thumb.jpg');
    expect(details?.watchHref).toBe('/videos/v_winter_ep1');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Winter Intensive 2026');
    expect(compiled.textContent).toContain('Series • 3 Parts');
    expect(compiled.textContent).toContain('2h');
    expect(compiled.textContent).toContain('series_winter_2026');
    const watchLink = compiled.querySelector('a.watch-btn') as HTMLAnchorElement;
    expect(watchLink.getAttribute('href')).toBe('/videos/v_winter_ep1');
  });

  it('should resolve and render single video details when videoId matches a video docId', () => {
    fixture.componentRef.setInput('videoId', 'v_spinning_single');
    fixture.detectChanges();

    const details = component.details();
    expect(details).not.toBeNull();
    expect(details?.kind).toBe('video');
    expect(details?.title).toBe('Spinning Hands Fundamentals');
    expect(details?.durationText).toBe('1h');
    expect(details?.thumbnailUrl).toBe('https://images.example/spinning-thumb.jpg');
    expect(details?.watchHref).toBe('/videos/v_spinning_single');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Spinning Hands Fundamentals');
    expect(compiled.textContent).toContain('Single Video');
    expect(compiled.textContent).toContain('1h');
    expect(compiled.textContent).toContain('v_spinning_single');
  });

  it('should handle external video URL gracefully', () => {
    fixture.componentRef.setInput('videoId', 'https://vimeo.com/123456789');
    fixture.detectChanges();

    const details = component.details();
    expect(details?.kind).toBe('external');
    expect(details?.watchHref).toBe('https://vimeo.com/123456789');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('External Link');
    expect(compiled.textContent).toContain('https://vimeo.com/123456789');
  });

  it('should emit unlink when unlink button clicked', () => {
    fixture.componentRef.setInput('videoId', 'v_spinning_single');
    fixture.componentRef.setInput('showUnlink', true);
    fixture.detectChanges();

    const unlinkSpy = vi.fn();
    component.unlink.subscribe(unlinkSpy);

    const compiled = fixture.nativeElement as HTMLElement;
    const unlinkBtn = compiled.querySelector('button.unlink-btn') as HTMLButtonElement;
    expect(unlinkBtn).not.toBeNull();
    unlinkBtn.click();

    expect(unlinkSpy).toHaveBeenCalledTimes(1);
  });
});
