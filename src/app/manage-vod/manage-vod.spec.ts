/* manage-vod.spec.ts
 *
 * Unit tests for ManageVodComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageVodComponent } from './manage-vod';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { initVideoItem, VideoItem, VodAccessTier, VodCategory, VodStatus } from '../../../functions/src/data-model';
import { signal, WritableSignal } from '@angular/core';

describe('ManageVodComponent', () => {
  let component: ManageVodComponent;
  let fixture: ComponentFixture<ManageVodComponent>;
  let mockDataService: {
    videos: { entries: WritableSignal<VideoItem[]> };
    saveVideo: ReturnType<typeof vi.fn>;
    deleteVideo: ReturnType<typeof vi.fn>;
    transcodeVideoForVod: ReturnType<typeof vi.fn>;
  };
  let mockFirebaseState: {
    user: WritableSignal<{ isAdmin: boolean; member: { docId: string } } | null>;
  };
  let mockRoutingService: {
    signals: {
      manageVod: {
        urlParams: {
          q: WritableSignal<string | null>;
          status: WritableSignal<string | null>;
          category: WritableSignal<string | null>;
        };
      };
    };
    hrefForView: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockDataService = {
      videos: {
        entries: signal([
          {
            ...initVideoItem(),
            docId: 'v1',
            title: 'Sample Video 1',
            vodStatus: VodStatus.Ready,
            isPublished: true,
            durationSeconds: 3600,
            category: VodCategory.SeminarRecording,
            lastUpdated: '2026-01-01',
          },
          {
            ...initVideoItem(),
            docId: 'v2',
            title: 'Sample Video 2',
            vodStatus: VodStatus.Transcoding,
            isPublished: false,
            durationSeconds: 1800,
            category: VodCategory.TechniqueBreakdown,
            lastUpdated: '2026-01-02',
          },
        ]),
      },
      saveVideo: vi.fn().mockResolvedValue(undefined),
      deleteVideo: vi.fn().mockResolvedValue(undefined),
      transcodeVideoForVod: vi.fn().mockResolvedValue({ success: true }),
    };

    mockFirebaseState = {
      user: signal({ isAdmin: true, member: { docId: 'admin1' } }),
    };

    mockRoutingService = {
      signals: {
        manageVod: {
          urlParams: {
            q: signal(null),
            status: signal(null),
            category: signal(null),
          },
        },
      },
      hrefForView: vi.fn().mockReturnValue('/videos/v1'),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVodComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageVodComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should calculate stats correctly', () => {
    const stats = component.stats();
    expect(stats.total).toBe(2);
    expect(stats.published).toBe(1);
    expect(stats.ready).toBe(1);
    expect(stats.processing).toBe(1);
    expect(stats.totalHours).toBe('1.5');
  });

  it('should open and close edit modal', () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);
    expect(component.editingVideo()).toBeTruthy();
    expect(component.editingVideo()?.docId).toBe('v1');

    component.closeEditModal();
    expect(component.editingVideo()).toBeNull();
  });

  it('should save edited video metadata', async () => {
    const video = mockDataService.videos.entries()[0];
    component.openEditModal(video);
    component.editTagInput.set('spinning, form');
    component.priceDollars.set(25.00);

    await component.saveVideoChanges();
    expect(mockDataService.saveVideo).toHaveBeenCalled();
    expect(component.editingVideo()).toBeNull();
  });
});
