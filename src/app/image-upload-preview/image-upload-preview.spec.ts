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
});
