/* manage-video-tags.spec.ts
 *
 * Unit tests for ManageVideoTagsComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ManageVideoTagsComponent } from './manage-video-tags';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService } from '../firebase-state.service';
import { RoutingService } from '../routing.service';
import { signal, WritableSignal } from '@angular/core';
import { initVideoItem, VideoItem, VideoTagMeta } from '../../../functions/src/data-model';

describe('ManageVideoTagsComponent', () => {
  let component: ManageVideoTagsComponent;
  let fixture: ComponentFixture<ManageVideoTagsComponent>;
  let mockDataService: {
    tagsDoc: WritableSignal<Record<string, VideoTagMeta>>;
    videos: {
      entries: WritableSignal<VideoItem[]>;
    };
    getTagMeta: ReturnType<typeof vi.fn>;
    saveVideoTagMeta: ReturnType<typeof vi.fn>;
    renameVideoTag: ReturnType<typeof vi.fn>;
    deleteVideoTag: ReturnType<typeof vi.fn>;
  };
  let mockFirebaseState: {
    user: WritableSignal<{ isAdmin: boolean; member: { docId: string } } | null>;
  };
  let mockRoutingService: {
    hrefForView: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const sampleTags: Record<string, VideoTagMeta> = {
      spinning: {
        tag: 'spinning',
        label: 'Spinning Hands',
        description: 'Circular energy exercise',
        createdAt: '2026-01-01',
        lastUpdated: '2026-01-01',
      },
      basics: {
        tag: 'basics',
        label: 'Basics',
        description: 'Foundational stances',
        createdAt: '2026-01-01',
        lastUpdated: '2026-01-01',
      },
    };

    const sampleVideos: VideoItem[] = [
      {
        ...initVideoItem(),
        docId: 'v1',
        title: 'Video 1',
        tags: ['spinning', 'basics'],
      },
      {
        ...initVideoItem(),
        docId: 'v2',
        title: 'Video 2',
        tags: ['spinning'],
      },
    ];

    mockDataService = {
      tagsDoc: signal(sampleTags),
      videos: {
        entries: signal(sampleVideos),
      },
      getTagMeta: vi.fn((tag: string) => sampleTags[tag]),
      saveVideoTagMeta: vi.fn().mockResolvedValue(undefined),
      renameVideoTag: vi.fn().mockResolvedValue({ updatedVideos: 2 }),
      deleteVideoTag: vi.fn().mockResolvedValue(undefined),
    };

    mockFirebaseState = {
      user: signal({ isAdmin: true, member: { docId: 'admin1' } }),
    };

    mockRoutingService = {
      hrefForView: vi.fn().mockReturnValue('/manage-vod'),
    };

    await TestBed.configureTestingModule({
      imports: [ManageVideoTagsComponent],
      providers: [
        { provide: DataManagerService, useValue: mockDataService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManageVideoTagsComponent);
    component = fixture.componentInstance;
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should compute tag rows with accurate video usage counts', () => {
    const rows = component.tagRows();
    expect(rows.length).toBe(2);

    const spinning = rows.find((r) => r.tag === 'spinning');
    expect(spinning?.videoCount).toBe(2);
    expect(spinning?.label).toBe('Spinning Hands');

    const basics = rows.find((r) => r.tag === 'basics');
    expect(basics?.videoCount).toBe(1);
  });

  it('should filter tags by search query', () => {
    component.searchQuery.set('circular');
    const filtered = component.tagRows();
    expect(filtered.length).toBe(1);
    expect(filtered[0].tag).toBe('spinning');
  });

  it('should save a new tag', async () => {
    component.openAddModal();
    component.newTagSlug.set('partner_drills');
    component.newTagLabel.set('Partner Drills');
    component.newTagDescription.set('Two-person coordination');

    await component.saveNewTag();

    expect(mockDataService.saveVideoTagMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'partner_drills',
        label: 'Partner Drills',
        description: 'Two-person coordination',
      }),
    );
    expect(component.isAddModalOpen()).toBe(false);
  });

  it('should rename a tag across all videos', async () => {
    const row = component.tagRows().find((r) => r.tag === 'spinning')!;
    component.openEditModal(row);
    component.editTagSlug.set('spinning_hands');
    component.editTagLabel.set('Spinning Hands (Updated)');

    await component.saveTagEdits();

    expect(mockDataService.renameVideoTag).toHaveBeenCalledWith(
      'spinning',
      'spinning_hands',
      expect.objectContaining({
        label: 'Spinning Hands (Updated)',
      }),
    );
    expect(component.editingTag()).toBeNull();
  });

  it('should update metadata when slug is unchanged', async () => {
    const row = component.tagRows().find((r) => r.tag === 'spinning')!;
    component.openEditModal(row);
    component.editTagDescription.set('New description');

    await component.saveTagEdits();

    expect(mockDataService.saveVideoTagMeta).toHaveBeenCalledWith(
      expect.objectContaining({
        tag: 'spinning',
        description: 'New description',
      }),
    );
  });

  it('should delete a tag', async () => {
    component.confirmDelete('spinning');
    await component.executeDelete();
    expect(mockDataService.deleteVideoTag).toHaveBeenCalledWith('spinning');
    expect(component.deletingTagSlug()).toBeNull();
  });
});
