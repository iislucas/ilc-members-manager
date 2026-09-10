import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ImageUploadPreviewComponent } from './image-upload-preview';

describe('ImageUploadPreviewComponent', () => {
  let component: ImageUploadPreviewComponent;
  let fixture: ComponentFixture<ImageUploadPreviewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageUploadPreviewComponent]
    })
    .compileComponents();

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
    component.imageUrl.set('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
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

    component.imageUrl.set('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    await fixture.whenStable();
    fixture.detectChanges();

    // Mock canvas.getContext and toBlob in JSDOM
    const canvas = component.canvasRef.nativeElement;
    canvas.getContext = (() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })) as any;
    canvas.toBlob = (callback: BlobCallback, type?: string) => {
      callback(new Blob(['test'], { type: type || 'image/png' }));
    };

    await component.applyCrop();

    expect(emittedResult).toBeTruthy();
    expect(emittedResult!.largeBlob.type).toBe('image/png');
    expect(emittedResult!.thumbBlob.type).toBe('image/png');
  });

  it('should allow user to change and reset aspect ratio when allowAspectRatioChoice is enabled', async () => {
    fixture.componentRef.setInput('allowAspectRatioChoice', true);
    fixture.componentRef.setInput('aspectRatio', 3 / 2);
    component.imageUrl.set('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
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
});
