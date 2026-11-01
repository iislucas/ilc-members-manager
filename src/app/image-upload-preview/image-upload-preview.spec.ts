/* image-upload-preview.spec.ts
 *
 * Unit tests for ImageUploadPreviewComponent, covering aspect ratio selection,
 * localStorage persistence, zoom-out (< 1x) with transparent padding, SVG
 * dimension normalization, and remote image CORS fallback.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ImageUploadPreviewComponent, MIN_ZOOM_SCALE } from './image-upload-preview';

describe('ImageUploadPreviewComponent', () => {
  let component: ImageUploadPreviewComponent;
  let fixture: ComponentFixture<ImageUploadPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageUploadPreviewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ImageUploadPreviewComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not have hardcoded file-upload id on input', () => {
    const input = fixture.nativeElement.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input.getAttribute('id')).toBeNull();
  });

  it('should apply aspect-ratio to crop container when image is set', async () => {
    fixture.componentRef.setInput('aspectRatio', 1200 / 450);
    component.imageUrl.set(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const cropContainer: HTMLElement = fixture.nativeElement.querySelector('.crop-container');
    expect(cropContainer).toBeTruthy();
    expect(component.aspectRatio()).toBeCloseTo(1200 / 450);
  });

  it('should emit PNG blobs to preserve transparency', async () => {
    let emittedResult: { thumbBlob: Blob; largeBlob: Blob } | null = null;
    component.imageCropped.subscribe((result) => {
      emittedResult = result;
    });

    component.imageUrl.set(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const canvas = component.canvasRef.nativeElement;
    canvas.getContext = (() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })) as unknown as typeof canvas.getContext;
    canvas.toBlob = (callback: BlobCallback, type?: string) => {
      callback(new Blob(['test'], { type: type || 'image/png' }));
    };

    await component.applyCrop();

    expect(emittedResult).toBeTruthy();
    expect(emittedResult!.largeBlob.type).toBe('image/png');
    expect(emittedResult!.thumbBlob.type).toBe('image/png');
  });

  it('allows zooming out below 1x and draws onto canvas with positive destination offsets (transparent padding)', async () => {
    fixture.componentRef.setInput('aspectRatio', 1);
    fixture.componentRef.setInput('largeDimensions', { width: 400, height: 400 });
    fixture.componentRef.setInput('thumbDimensions', { width: 100, height: 100 });

    component.imageUrl.set(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const rangeInput: HTMLInputElement = fixture.nativeElement.querySelector('input[type="range"]');
    expect(parseFloat(rangeInput.min)).toBe(MIN_ZOOM_SCALE);
    expect(MIN_ZOOM_SCALE).toBeLessThan(1);

    const container = component.containerRef.nativeElement;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 200,
      top: 0,
      left: 0,
      right: 200,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const img = component.imgRef.nativeElement;
    Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });

    component.onImageLoad();
    expect(component.baseScale()).toBeCloseTo(0.5); // 200 / 400
    expect(component.translateX()).toBeCloseTo(0);
    expect(component.translateY()).toBeCloseTo(0);

    // Zoom out to 0.5x via slider input -> displayed size is 100x100 inside 200x200 container, centered at (50, 50)
    component.onZoomChange({ target: { value: '0.5' } } as unknown as Event);
    expect(component.scale()).toBeCloseTo(0.5);
    expect(component.translateX()).toBeCloseTo(50);
    expect(component.translateY()).toBeCloseTo(50);

    // When zoomed out, dragging allows positioning within [0, container - displayed] = [0, 100]
    expect(component.constrainTranslation(80, 20)).toEqual({ x: 80, y: 20 });
    expect(component.constrainTranslation(-25, 150)).toEqual({ x: 0, y: 100 });

    // Re-center at (50, 50) and verify applyCrop clears canvas (transparent) and draws at scaled positive coords
    component.translateX.set(50);
    component.translateY.set(50);

    const drawImageCalls: number[][] = [];
    const clearRectCalls: number[][] = [];
    const canvas = component.canvasRef.nativeElement;
    canvas.getContext = (() => ({
      clearRect: (...args: number[]) => clearRectCalls.push(args),
      drawImage: (_img: unknown, ...coords: number[]) => drawImageCalls.push(coords),
    })) as unknown as typeof canvas.getContext;
    canvas.toBlob = (callback: BlobCallback, type?: string) => {
      callback(new Blob(['png-bytes'], { type: type || 'image/png' }));
    };

    await component.applyCrop();

    // Thumb is 100x100 (0.5x of 200x200 container) -> dx=25, dy=25, dw=50, dh=50
    // Large is 400x400 (2x of 200x200 container) -> dx=100, dy=100, dw=200, dh=200
    expect(clearRectCalls).toEqual([
      [0, 0, 100, 100],
      [0, 0, 400, 400],
    ]);
    expect(drawImageCalls).toEqual([
      [25, 25, 50, 50],
      [100, 100, 200, 200],
    ]);
  });

  it('normalizes SVG files lacking explicit width/height using viewBox so natural dimensions work', async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><circle cx="75" cy="75" r="50"/></svg>';
    const svgFile = new File([svgContent], 'logo.svg', { type: 'image/svg+xml' });

    await component.onFileSelected({
      target: { files: [svgFile] },
    } as unknown as Event);

    // Wait for FileReader to complete
    await vi.waitFor(() => {
      expect(component.imageUrl()).toBeTruthy();
    });

    const dataUrl = component.imageUrl()!;
    expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const decodedSvg = atob(dataUrl.split(',')[1]);
    expect(decodedSvg).toContain('width="300"');
    expect(decodedSvg).toContain('height="150"');
  });

  it('falls back to rendering without crossorigin when remote fetch fails due to CORS', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    try {
      fixture.componentRef.setInput(
        'initialImageUrl',
        'https://firebasestorage.googleapis.com/v0/b/test-bucket/o/schools%2Fs1%2Fprofile_large?alt=media',
      );
      await fixture.whenStable();
      await vi.waitFor(() => {
        expect(component.imageUrl()).toBe(
          'https://firebasestorage.googleapis.com/v0/b/test-bucket/o/schools%2Fs1%2Fprofile_large?alt=media',
        );
      });
      fixture.detectChanges();

      expect(component.useCrossOrigin()).toBe(false);
      const imgEl: HTMLImageElement = fixture.nativeElement.querySelector('img');
      expect(imgEl).toBeTruthy();
      expect(imgEl.getAttribute('crossorigin')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('should allow user to change and reset aspect ratio when allowAspectRatioChoice is enabled', async () => {
    fixture.componentRef.setInput('allowAspectRatioChoice', true);
    fixture.componentRef.setInput('aspectRatio', 3 / 2);
    component.imageUrl.set(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    component.naturalRatio.set(2.0); // 2:1 natural image
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.aspect-ratio-control')).not.toBeNull();
    expect(component.resolvedAspectRatio()).toBeCloseTo(1.5); // Default 3:2

    // Change to 1:1
    component.setAspectRatio(1);
    fixture.detectChanges();
    expect(component.resolvedAspectRatio()).toBeCloseTo(1.0);
    expect(component.activeRatioKey()).toBe('1:1');

    // Change to natural/original ratio
    component.setAspectRatio(component.naturalRatio());
    fixture.detectChanges();
    expect(component.resolvedAspectRatio()).toBeCloseTo(2.0);
    expect(component.activeRatioKey()).toBe('original');

    // Reset back to default
    component.resetAspectRatio();
    fixture.detectChanges();
    expect(component.resolvedAspectRatio()).toBeCloseTo(1.5);
    expect(component.activeRatioKey()).toBe('3:2');
  });

  it('defaults to original/natural aspect ratio when aspectRatio is null', async () => {
    fixture.componentRef.setInput('allowAspectRatioChoice', true);
    fixture.componentRef.setInput('aspectRatio', null);
    component.imageUrl.set(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    component.naturalRatio.set(1.85);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.activeRatioKey()).toBe('original');
    expect(component.resolvedAspectRatio()).toBeCloseTo(1.85);
  });

  it('remembers aspect ratio preference in localStorage via storageKey', async () => {
    const storageKey = 'test_image_aspect_ratio_pref';
    localStorage.removeItem(storageKey);

    fixture.componentRef.setInput('allowAspectRatioChoice', true);
    fixture.componentRef.setInput('storageKey', storageKey);
    component.imageUrl.set(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    component.naturalRatio.set(2.0);
    await fixture.whenStable();
    fixture.detectChanges();

    // Select 16:9
    component.selectRatioKey('16:9');
    fixture.detectChanges();
    expect(localStorage.getItem(storageKey)).toBe('16:9');
    expect(component.activeRatioKey()).toBe('16:9');
    expect(component.resolvedAspectRatio()).toBeCloseTo(16 / 9);

    // Create a new component instance with the same storageKey - should restore 16:9
    const secondFixture = TestBed.createComponent(ImageUploadPreviewComponent);
    const secondComp = secondFixture.componentInstance;
    secondFixture.componentRef.setInput('allowAspectRatioChoice', true);
    secondFixture.componentRef.setInput('storageKey', storageKey);
    secondComp.imageUrl.set(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );
    secondComp.naturalRatio.set(1.33);
    await secondFixture.whenStable();
    secondFixture.detectChanges();

    expect(secondComp.activeRatioKey()).toBe('16:9');
    expect(secondComp.resolvedAspectRatio()).toBeCloseTo(16 / 9);

    // Change to original
    secondComp.selectRatioKey('original');
    secondFixture.detectChanges();
    expect(localStorage.getItem(storageKey)).toBe('original');
    expect(secondComp.activeRatioKey()).toBe('original');
    expect(secondComp.resolvedAspectRatio()).toBeCloseTo(1.33);

    // Clean up
    localStorage.removeItem(storageKey);
  });
});
