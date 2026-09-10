/* video-time-ranges.spec.ts
 *
 * Unit tests for VideoTimeRangesComponent.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoTimeRangesComponent } from './video-time-ranges';
import { DataManagerService } from '../data-manager.service';
import { initVideoItem, VideoTimeRange } from '../../../functions/src/data-model/vod';

describe('VideoTimeRangesComponent', () => {
  let component: VideoTimeRangesComponent;
  let fixture: ComponentFixture<VideoTimeRangesComponent>;
  let mockDataService: {
    getVideoTimeRanges: ReturnType<typeof vi.fn>;
    saveVideoTimeRanges: ReturnType<typeof vi.fn>;
  };

  const sampleRanges: VideoTimeRange[] = [
    {
      id: 'tr-1',
      name: 'Drill 1 - Opening',
      description: 'Focus on relaxation',
      startSeconds: 10,
      endSeconds: 40,
    },
    {
      id: 'tr-2',
      name: 'Drill 2 - Spinning Hands',
      description: 'Maintain spherical alignment',
      startSeconds: 60,
      endSeconds: 120,
    },
  ];

  beforeEach(async () => {
    mockDataService = {
      getVideoTimeRanges: vi.fn().mockResolvedValue([...sampleRanges]),
      saveVideoTimeRanges: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [VideoTimeRangesComponent],
      providers: [{ provide: DataManagerService, useValue: mockDataService }],
    }).compileComponents();

    fixture = TestBed.createComponent(VideoTimeRangesComponent);
    component = fixture.componentInstance;

    // Set required input
    const testVideo = initVideoItem();
    testVideo.docId = 'test-vid-1';
    testVideo.title = 'Spinning Hands Masterclass';
    testVideo.durationSeconds = 600;
    fixture.componentRef.setInput('video', testVideo);
  });

  it('should create and load initial time ranges', async () => {
    await component.ngOnInit();
    expect(component).toBeTruthy();
    expect(mockDataService.getVideoTimeRanges).toHaveBeenCalledWith('test-vid-1');
    expect(component.ranges().length).toBe(2);
    expect(component.sortedRanges()[0].startSeconds).toBe(10);
    expect(component.sortedRanges()[1].startSeconds).toBe(60);
  });

  it('should parse and format time strings accurately', () => {
    expect(component.formatSecondsToTimeString(0)).toBe('00:00');
    expect(component.formatSecondsToTimeString(65)).toBe('01:05');
    expect(component.formatSecondsToTimeString(3665)).toBe('1:01:05');

    expect(component.parseTimeToSeconds('10')).toBe(10);
    expect(component.parseTimeToSeconds('01:05')).toBe(65);
    expect(component.parseTimeToSeconds('1:01:05')).toBe(3665);
    expect(component.parseTimeToSeconds('invalid')).toBeNull();
    expect(component.parseTimeToSeconds('')).toBeNull();
  });

  it('should open and submit add modal with validation', async () => {
    await component.ngOnInit();
    fixture.componentRef.setInput('currentPlayerTime', 45);

    component.openAddModal();
    expect(component.isFormOpen()).toBe(true);
    expect(component.editingId()).toBeNull();
    expect(component.formStart()).toBe('00:45');

    // Missing name validation
    component.formName.set('');
    await component.submitForm();
    expect(component.formError()).toContain('provide a name');

    // Invalid time validation (end <= start)
    component.formName.set('Test Technique');
    component.formStart.set('01:00');
    component.formEnd.set('00:50');
    await component.submitForm();
    expect(component.formError()).toContain('greater than start time');

    // Valid submission
    component.formStart.set('01:00');
    component.formEnd.set('02:00');
    component.formDescription.set('Good posture note');
    await component.submitForm();

    expect(component.isFormOpen()).toBe(false);
    expect(component.ranges().length).toBe(3);
    expect(mockDataService.saveVideoTimeRanges).toHaveBeenCalled();
    const lastSaved = component.ranges()[component.ranges().length - 1];
    expect(lastSaved.name).toBe('Test Technique');
    expect(lastSaved.startSeconds).toBe(60);
    expect(lastSaved.endSeconds).toBe(120);
  });

  it('should edit an existing time range', async () => {
    await component.ngOnInit();
    const toEdit = component.ranges()[0];

    component.openEditModal(toEdit);
    expect(component.isFormOpen()).toBe(true);
    expect(component.editingId()).toBe('tr-1');
    expect(component.formName()).toBe('Drill 1 - Opening');

    component.formName.set('Drill 1 - Modified Opening');
    component.formStart.set('00:15');
    component.formEnd.set('00:45');
    await component.submitForm();

    expect(component.isFormOpen()).toBe(false);
    const updated = component.ranges().find((r) => r.id === 'tr-1');
    expect(updated?.name).toBe('Drill 1 - Modified Opening');
    expect(updated?.startSeconds).toBe(15);
    expect(updated?.endSeconds).toBe(45);
    expect(mockDataService.saveVideoTimeRanges).toHaveBeenCalled();
  });

  it('should emit playRange for seeking and loop toggling', async () => {
    await component.ngOnInit();
    const range = component.ranges()[0];

    let emittedPlay: { range: VideoTimeRange; loop: boolean } | null = null;
    component.playRange.subscribe((val) => {
      emittedPlay = val;
    });

    let emittedStop = false;
    component.stopLoop.subscribe(() => {
      emittedStop = true;
    });

    // 1. Regular seek
    component.onPlayRange(range);
    expect(emittedPlay).toEqual({ range, loop: false });

    // 2. Start loop
    component.onToggleLoop(range);
    expect(emittedPlay).toEqual({ range, loop: true });

    // 3. Toggle when currently looping should emit stopLoop
    fixture.componentRef.setInput('activeLoopRange', {
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      name: range.name,
    });
    expect(component.isRangeLooping(range)).toBe(true);

    component.onToggleLoop(range);
    expect(emittedStop).toBe(true);
  });

  it('should handle deletion of a single range', async () => {
    await component.ngOnInit();
    const toDelete = component.ranges()[0];

    component.promptDeleteOne(toDelete);
    expect(component.showDeleteModal()).toBe(true);

    await component.confirmDelete();
    expect(component.showDeleteModal()).toBe(false);
    expect(component.ranges().length).toBe(1);
    expect(component.ranges()[0].id).toBe('tr-2');
    expect(mockDataService.saveVideoTimeRanges).toHaveBeenCalled();
  });

  it('should handle batch deletion of selected ranges', async () => {
    await component.ngOnInit();
    component.toggleSelect('tr-1');
    expect(component.selectedCount()).toBe(1);

    component.promptDeleteSelected();
    expect(component.showDeleteModal()).toBe(true);

    await component.confirmDelete();
    expect(component.ranges().length).toBe(1);
    expect(component.ranges()[0].id).toBe('tr-2');
    expect(component.selectedCount()).toBe(0);
  });

  it('should format export filename and JSON payload', async () => {
    await component.ngOnInit();
    const filename = component.getExportFilename();
    expect(filename).toBe('spinning_hands_masterclass.time-ranges.json');

    const jsonStr = component.getExportPayload();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.version).toBe(1);
    expect(parsed.videoId).toBe('test-vid-1');
    expect(parsed.videoTitle).toBe('Spinning Hands Masterclass');
    expect(parsed.timeRanges.length).toBe(2);
    expect(parsed.timeRanges[0].name).toBe('Drill 1 - Opening');
  });

  it('should additively import JSON without creating duplicates', async () => {
    await component.ngOnInit();
    expect(component.ranges().length).toBe(2);

    // Import payload with 1 duplicate and 1 new range
    const importPayload = {
      timeRanges: [
        // Duplicate (exact same name and timestamps)
        {
          name: 'Drill 1 - Opening',
          startSeconds: 10,
          endSeconds: 40,
        },
        // New item
        {
          name: 'Drill 3 - Step Back Neutral',
          description: 'Step smoothly without dropping weight',
          startSeconds: 150,
          endSeconds: 210,
        },
      ],
    };

    component.importJsonText.set(JSON.stringify(importPayload));
    await component.processImport();

    expect(component.importFeedback()?.type).toBe('success');
    expect(component.importFeedback()?.message).toContain('imported 1 new range');
    expect(component.importFeedback()?.message).toContain('1 duplicate(s) skipped');

    // Total should now be 3
    expect(component.ranges().length).toBe(3);
    const names = component.ranges().map((r) => r.name);
    expect(names).toContain('Drill 3 - Step Back Neutral');
  });

  it('should reject import when all items are duplicates', async () => {
    await component.ngOnInit();

    const duplicatePayload = {
      timeRanges: [
        {
          name: 'Drill 1 - Opening',
          startSeconds: 10,
          endSeconds: 40,
        },
      ],
    };

    component.importJsonText.set(JSON.stringify(duplicatePayload));
    await component.processImport();

    expect(component.importFeedback()?.type).toBe('error');
    expect(component.importFeedback()?.message).toContain('already in your annotations');
    expect(component.ranges().length).toBe(2);
  });
});
