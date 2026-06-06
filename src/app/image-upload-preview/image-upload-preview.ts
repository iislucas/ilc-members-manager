/* image-upload-preview.ts
 *
 * Component for uploading an image and previewing it with zoom and pan
 * to select a specific crop area. Outputs the cropped image as a Blob.
 */

import { Component, ElementRef, ViewChild, signal, computed, output, input, effect } from '@angular/core';
import { IconComponent } from '../icons/icon.component';

@Component({
  selector: 'app-image-upload-preview',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './image-upload-preview.html',
  styleUrl: './image-upload-preview.scss',
})
export class ImageUploadPreviewComponent {
  @ViewChild('previewCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewImg', { static: false }) imgRef!: ElementRef<HTMLImageElement>;
  @ViewChild('container', { static: false }) containerRef!: ElementRef<HTMLDivElement>;

  // Inputs
  aspectRatio = input(3 / 2); // Default 3:2
  initialImageUrl = input<string | null>(null);
  // Output dimensions of the two generated crops. Defaults match the event
  // hero image (large 600x400, thumb 120x80); callers cropping other shapes
  // (e.g. a square profile picture) override these. The crop frame uses
  // aspectRatio(), so the dimensions here should share that aspect ratio.
  largeDimensions = input<{ width: number; height: number }>({ width: 600, height: 400 });
  thumbDimensions = input<{ width: number; height: number }>({ width: 120, height: 80 });
  // Prompt text shown on the file-select button.
  uploadPromptText = input('select a 600x400 or larger image');

  // Outputs
  imageCropped = output<{
    thumbBlob: Blob;
    largeBlob: Blob;
    originalFile?: File;
  }>();
  cancel = output<void>();

  // State
  selectedFile = signal<File | null>(null);
  imageUrl = signal<string | null>(null);
  scale = signal(1);
  baseScale = signal(1);
  translateX = signal(0);
  translateY = signal(0);
  totalScale = computed(() => this.baseScale() * this.scale());
  scaleText = computed(() => this.scale().toFixed(1));

  constructor() {
    effect(() => {
      const url = this.initialImageUrl();
      if (url) {
        this.imageUrl.set(url);
      }
    });
  }

  isDragging = false;
  startX = 0;
  startY = 0;

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.selectedFile.set(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      this.imageUrl.set(e.target?.result as string);
      this.resetTransform();
    };
    reader.readAsDataURL(file);
  }

  resetTransform() {
    this.scale.set(1);
    this.translateX.set(0);
    this.translateY.set(0);
  }

  onImageLoad() {
    const img = this.imgRef.nativeElement;
    const container = this.containerRef.nativeElement;
    
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    const scaleX = containerWidth / img.naturalWidth;
    const scaleY = containerHeight / img.naturalHeight;
    
    const fitScale = Math.max(scaleX, scaleY);
    this.baseScale.set(fitScale);
    
    const displayedWidth = img.naturalWidth * fitScale;
    const displayedHeight = img.naturalHeight * fitScale;
    
    this.translateX.set((containerWidth - displayedWidth) / 2);
    this.translateY.set((containerHeight - displayedHeight) / 2);
  }

  resetView() {
    this.scale.set(1);
    this.onImageLoad();
  }

  constrainTranslation(x: number, y: number): {x: number, y: number} {
    const img = this.imgRef.nativeElement;
    const container = this.containerRef.nativeElement;
    if (!img || !container) return {x, y};
    
    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;
    
    const displayedWidth = img.naturalWidth * this.totalScale();
    const displayedHeight = img.naturalHeight * this.totalScale();
    
    const minX = containerWidth - displayedWidth;
    const minY = containerHeight - displayedHeight;
    
    return {
      x: Math.min(0, Math.max(minX, x)),
      y: Math.min(0, Math.max(minY, y))
    };
  }

  onMouseDown(event: MouseEvent) {
    if (!this.imageUrl()) return;
    this.isDragging = true;
    this.startX = event.clientX - this.translateX();
    this.startY = event.clientY - this.translateY();
    event.preventDefault(); // Prevent text selection
  }

  onMouseMove(event: MouseEvent) {
    if (!this.isDragging) return;
    const constrained = this.constrainTranslation(event.clientX - this.startX, event.clientY - this.startY);
    this.translateX.set(constrained.x);
    this.translateY.set(constrained.y);
  }

  onMouseUp() {
    this.isDragging = false;
  }

  onWheel(event: WheelEvent) {
    if (!this.imageUrl()) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(1, Math.min(5, this.scale() + delta));
    this.scale.set(newScale);
    
    // Constrain translation after scale change
    const constrained = this.constrainTranslation(this.translateX(), this.translateY());
    this.translateX.set(constrained.x);
    this.translateY.set(constrained.y);
  }

  onZoomChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.scale.set(parseFloat(input.value));
    
    // Constrain translation after scale change
    const constrained = this.constrainTranslation(this.translateX(), this.translateY());
    this.translateX.set(constrained.x);
    this.translateY.set(constrained.y);
  }

  async applyCrop() {
    const img = this.imgRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const container = this.containerRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    const displayedWidth = img.width;
    const displayedHeight = img.height;

    const ratioX = img.naturalWidth / displayedWidth;
    const ratioY = img.naturalHeight / displayedHeight;

    const sx = (-this.translateX() / this.totalScale()) * ratioX;
    const sy = (-this.translateY() / this.totalScale()) * ratioY;
    const sw = (containerWidth / this.totalScale()) * ratioX;
    const sh = (containerHeight / this.totalScale()) * ratioY;

    // Generate Thumb (configurable, defaults to 120x80).
    const thumb = this.thumbDimensions();
    canvas.width = thumb.width;
    canvas.height = thumb.height;
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, thumb.width, thumb.height);
    const thumbBlob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));

    // Generate Large (configurable, defaults to 600x400).
    const large = this.largeDimensions();
    canvas.width = large.width;
    canvas.height = large.height;
    ctx.clearRect(0, 0, large.width, large.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, large.width, large.height);
    const largeBlob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));

    this.imageCropped.emit({
      thumbBlob,
      largeBlob,
      originalFile: this.selectedFile() || undefined
    });
  }

  onCancel() {
    this.imageUrl.set(null);
    this.selectedFile.set(null);
    this.cancel.emit();
  }
}
