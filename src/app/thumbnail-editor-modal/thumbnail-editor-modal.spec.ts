/* thumbnail-editor-modal.spec.ts */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThumbnailEditorModalComponent } from './thumbnail-editor-modal';
import * as utils from '../utils';

describe('ThumbnailEditorModalComponent', () => {
  let component: ThumbnailEditorModalComponent;
  let fixture: ComponentFixture<ThumbnailEditorModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ThumbnailEditorModalComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ThumbnailEditorModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
    expect(component.isOpen()).toBe(false);
  });

  it('should switch tabs between video_frame and upload_image', () => {
    expect(component.activeTab()).toBe('video_frame');
    component.activeTab.set('upload_image');
    expect(component.activeTab()).toBe('upload_image');
  });

  it('should format time correctly in formatTime', () => {
    expect(component.formatTime(0)).toBe('00:00.0');
    expect(component.formatTime(5.4)).toBe('00:05.4');
    expect(component.formatTime(75.8)).toBe('01:15.8');
    expect(component.formatTime(NaN)).toBe('00:00.0');
  });

  it('should emit closed output on close()', () => {
    const closedSpy = vi.fn();
    component.closed.subscribe(closedSpy);
    component.close();
    expect(closedSpy).toHaveBeenCalled();
  });

  it('should process image files and update capturedBlob and preview', async () => {
    const dummyBlob = new Blob(['mock-thumb-bytes'], { type: 'image/jpeg' });
    vi.spyOn(utils, 'createThumbnailFromImage').mockResolvedValue({
      blob: dummyBlob,
      width: 1280,
      height: 720,
    });

    const file = new File(['mock-image-data'], 'test.png', { type: 'image/png' });
    await component.processImageFile(file);

    expect(component.capturedBlob()).toBe(dummyBlob);
    expect(component.capturedDimensions()).toEqual({ w: 1280, h: 720 });
    expect(component.aspectRatioText()).toBe('16:9');
  });

  it('should emit thumbnailSelected event when applyThumbnail is called', () => {
    const selectedSpy = vi.fn();
    component.thumbnailSelected.subscribe(selectedSpy);

    const dummyBlob = new Blob(['test-blob'], { type: 'image/jpeg' });
    component.capturedBlob.set(dummyBlob);
    component.capturedPreviewUrl.set('blob:http://localhost/test');
    component.capturedDimensions.set({ w: 960, h: 720 });

    component.applyThumbnail();

    expect(selectedSpy).toHaveBeenCalledWith({
      blob: dummyBlob,
      previewUrl: 'blob:http://localhost/test',
      width: 960,
      height: 720,
    });
  });
});
