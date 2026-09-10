/* image-upload-preview.ts
 *
 * Component for uploading an image and previewing it with zoom and pan
 * to select a specific crop area. Outputs the cropped image as a Blob.
 */

import { Component, ElementRef, ViewChild, signal, computed, output, input, effect, OnInit, OnDestroy } from '@angular/core';
import { IconComponent } from '../icons/icon.component';

export type RatioKey = 'original' | '3:2' | '16:9' | '4:3' | '1:1';

@Component({
  selector: 'app-image-upload-preview',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './image-upload-preview.html',
  styleUrl: './image-upload-preview.scss',
})
export class ImageUploadPreviewComponent implements OnInit, OnDestroy {
  @ViewChild('previewCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewImg', { static: false }) imgRef!: ElementRef<HTMLImageElement>;
  @ViewChild('container', { static: false }) containerRef!: ElementRef<HTMLDivElement>;

  // Inputs
  aspectRatio = input<number | null>(null); // Default null (natural/original), or a specific number
  allowAspectRatioChoice = input<boolean>(false);
  defaultRatioKey = input<RatioKey | null>(null);
  storageKey = input<string | null>(null);
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
    aspectRatio?: number | null;
    ratioKey?: RatioKey | 'custom';
  }>();
  aspectRatioChange = output<number | null>();
  ratioKeyChange = output<RatioKey | 'custom'>();
  cancel = output<void>();

  // State
  selectedFile = signal<File | null>(null);
  imageUrl = signal<string | null>(null);
  naturalRatio = signal<number | null>(null);
  selectedRatioKey = signal<RatioKey | null>(null);
  customAspectRatio = signal<number | null | undefined>(undefined);

  activeRatioKey = computed<RatioKey | 'custom'>(() => {
    const selected = this.selectedRatioKey();
    if (selected) return selected;

    const custom = this.customAspectRatio();
    if (custom !== undefined) {
      if (custom === null) return 'original';
      const natural = this.naturalRatio();
      if (natural && Math.abs(custom - natural) < 0.01) return 'original';
      if (Math.abs(custom - 3 / 2) < 0.01) return '3:2';
      if (Math.abs(custom - 16 / 9) < 0.01) return '16:9';
      if (Math.abs(custom - 4 / 3) < 0.01) return '4:3';
      if (Math.abs(custom - 1) < 0.01) return '1:1';
      return 'custom';
    }

    const defKey = this.defaultRatioKey();
    if (defKey) return defKey;

    const r = this.aspectRatio();
    if (r === null) return 'original';
    const natural = this.naturalRatio();
    if (natural && Math.abs(r - natural) < 0.01) return 'original';
    if (Math.abs(r - 3 / 2) < 0.01) return '3:2';
    if (Math.abs(r - 16 / 9) < 0.01) return '16:9';
    if (Math.abs(r - 4 / 3) < 0.01) return '4:3';
    if (Math.abs(r - 1) < 0.01) return '1:1';
    return 'custom';
  });

  resolvedAspectRatio = computed(() => {
    const key = this.activeRatioKey();
    switch (key) {
      case 'original':
        return this.naturalRatio() || 3 / 2;
      case '3:2':
        return 3 / 2;
      case '16:9':
        return 16 / 9;
      case '4:3':
        return 4 / 3;
      case '1:1':
        return 1;
      default:
        const custom = this.customAspectRatio();
        if (custom !== undefined && custom !== null && custom > 0) return custom;
        const ratio = this.aspectRatio();
        if (ratio !== null && ratio > 0) return ratio;
        return this.naturalRatio() || 3 / 2;
    }
  });

  naturalRatioText = computed(() => {
    const r = this.naturalRatio();
    return r ? r.toFixed(2) : '';
  });

  scale = signal(1);
  baseScale = signal(1);
  translateX = signal(0);
  translateY = signal(0);
  totalScale = computed(() => this.baseScale() * this.scale());
  scaleText = computed(() => this.scale().toFixed(1));

  private objectUrlToRevoke: string | null = null;

  ngOnInit() {
    this.restoreSavedRatioKey();
  }

  private restoreSavedRatioKey() {
    const sk = this.storageKey();
    if (!sk || typeof window === 'undefined' || !window.localStorage) return;
    try {
      const saved = localStorage.getItem(sk) as RatioKey | null;
      if (saved && ['original', '3:2', '16:9', '4:3', '1:1'].includes(saved)) {
        this.selectedRatioKey.set(saved);
      }
    } catch (e) {
      console.warn('Unable to read aspect ratio from localStorage:', e);
    }
  }

  private saveRatioKey(key: RatioKey | null) {
    const sk = this.storageKey();
    if (!sk || typeof window === 'undefined' || !window.localStorage) return;
    try {
      if (key) {
        localStorage.setItem(sk, key);
      } else {
        localStorage.removeItem(sk);
      }
    } catch (e) {
      console.warn('Unable to save aspect ratio to localStorage:', e);
    }
  }

  constructor() {
    effect(() => {
      const url = this.initialImageUrl();
      if (url) {
        this.loadRemoteImage(url);
      }
    });

    effect(() => {
      // Re-trigger layout when aspectRatio changes
      this.aspectRatio();
      if (this.imageUrl()) {
        setTimeout(() => this.resetView(), 0);
      }
    });
  }

  private loadRemoteImage(url: string) {
    if (typeof window !== 'undefined' && typeof fetch !== 'undefined' && (url.startsWith('http://') || url.startsWith('https://'))) {
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          if (this.objectUrlToRevoke) {
            URL.revokeObjectURL(this.objectUrlToRevoke);
          }
          const blobUrl = URL.createObjectURL(blob);
          this.objectUrlToRevoke = blobUrl;
          this.imageUrl.set(blobUrl);
        })
        .catch(() => {
          this.imageUrl.set(url);
        });
    } else {
      this.imageUrl.set(url);
    }
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
    const img = this.imgRef?.nativeElement;
    const container = this.containerRef?.nativeElement;
    if (!img || !container) return;
    
    if (img.naturalWidth && img.naturalHeight) {
      this.naturalRatio.set(img.naturalWidth / img.naturalHeight);
    }

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;
    if ((containerWidth === 0 || containerHeight === 0) && img.naturalWidth && img.naturalHeight) {
      requestAnimationFrame(() => this.onImageLoad());
      return;
    }
    if (!img.naturalWidth || !img.naturalHeight) return;

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
    const img = this.imgRef?.nativeElement;
    const container = this.containerRef?.nativeElement;
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

  private initialPinchDistance = 0;
  private initialPinchScale = 1;

  onTouchStart(event: TouchEvent) {
    if (!this.imageUrl() || event.touches.length === 0) return;
    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.isDragging = true;
      this.startX = touch.clientX - this.translateX();
      this.startY = touch.clientY - this.translateY();
    } else if (event.touches.length === 2) {
      this.isDragging = false;
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      this.initialPinchDistance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      this.initialPinchScale = this.scale();
    }
  }

  onTouchMove(event: TouchEvent) {
    if (event.touches.length === 1 && this.isDragging) {
      const touch = event.touches[0];
      const constrained = this.constrainTranslation(touch.clientX - this.startX, touch.clientY - this.startY);
      this.translateX.set(constrained.x);
      this.translateY.set(constrained.y);
    } else if (event.touches.length === 2 && this.initialPinchDistance > 0) {
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const ratio = currentDist / this.initialPinchDistance;
      const newScale = Math.max(1, Math.min(5, this.initialPinchScale * ratio));
      this.scale.set(newScale);
      const constrained = this.constrainTranslation(this.translateX(), this.translateY());
      this.translateX.set(constrained.x);
      this.translateY.set(constrained.y);
    }
  }

  onTouchEnd() {
    this.isDragging = false;
    this.initialPinchDistance = 0;
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

  selectRatioKey(key: RatioKey) {
    this.selectedRatioKey.set(key);
    this.customAspectRatio.set(undefined);
    this.saveRatioKey(key);
    this.ratioKeyChange.emit(key);
    this.aspectRatioChange.emit(this.resolvedAspectRatio());
    this.scale.set(1);
    this.resetTransform();
    setTimeout(() => this.resetView(), 0);
  }

  setAspectRatio(ratio: number | null) {
    this.customAspectRatio.set(ratio);
    if (ratio === null) {
      this.selectRatioKey('original');
    } else {
      const natural = this.naturalRatio();
      if (natural && Math.abs(ratio - natural) < 0.01) {
        this.selectRatioKey('original');
      } else if (Math.abs(ratio - 3 / 2) < 0.01) {
        this.selectRatioKey('3:2');
      } else if (Math.abs(ratio - 16 / 9) < 0.01) {
        this.selectRatioKey('16:9');
      } else if (Math.abs(ratio - 4 / 3) < 0.01) {
        this.selectRatioKey('4:3');
      } else if (Math.abs(ratio - 1) < 0.01) {
        this.selectRatioKey('1:1');
      } else {
        this.selectedRatioKey.set(null);
        this.ratioKeyChange.emit('custom');
        this.aspectRatioChange.emit(ratio);
        this.scale.set(1);
        this.resetTransform();
        setTimeout(() => this.resetView(), 0);
      }
    }
  }

  resetAspectRatio() {
    this.selectedRatioKey.set(null);
    this.customAspectRatio.set(undefined);
    this.saveRatioKey(null);
    this.ratioKeyChange.emit(this.activeRatioKey());
    this.aspectRatioChange.emit(this.resolvedAspectRatio());
    this.scale.set(1);
    this.resetTransform();
    setTimeout(() => this.resetView(), 0);
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

    // Generate Thumb (configurable, defaults to 120x80 or scaled to active ratio).
    const thumb = this.thumbDimensions();
    const activeRatio = this.resolvedAspectRatio();
    const thumbHeight = Math.max(1, Math.round(thumb.width / activeRatio));
    canvas.width = thumb.width;
    canvas.height = thumbHeight;
    ctx.clearRect(0, 0, thumb.width, thumbHeight);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, thumb.width, thumbHeight);

    let thumbBlob: Blob;
    let largeBlob: Blob;
    try {
      thumbBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to export thumbnail canvas to blob'));
        }, 'image/png');
      });

      // Generate Large (configurable, defaults to 600x400 or scaled to active ratio).
      const large = this.largeDimensions();
      const largeHeight = Math.max(1, Math.round(large.width / activeRatio));
      canvas.width = large.width;
      canvas.height = largeHeight;
      ctx.clearRect(0, 0, large.width, largeHeight);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, large.width, largeHeight);
      largeBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to export large canvas to blob'));
        }, 'image/png');
      });
    } catch (err) {
      console.error('Error exporting cropped image canvas:', err);
      if (this.selectedFile()) {
        const file = this.selectedFile()!;
        this.imageCropped.emit({
          thumbBlob: file,
          largeBlob: file,
          originalFile: file,
          aspectRatio: this.resolvedAspectRatio(),
          ratioKey: this.activeRatioKey(),
        });
        return;
      }
      throw err;
    }

    this.imageCropped.emit({
      thumbBlob,
      largeBlob,
      originalFile: this.selectedFile() || undefined,
      aspectRatio: this.resolvedAspectRatio(),
      ratioKey: this.activeRatioKey(),
    });
  }

  onCancel() {
    if (this.objectUrlToRevoke) {
      URL.revokeObjectURL(this.objectUrlToRevoke);
      this.objectUrlToRevoke = null;
    }
    this.imageUrl.set(null);
    this.selectedFile.set(null);
    this.cancel.emit();
  }

  ngOnDestroy() {
    if (this.objectUrlToRevoke) {
      URL.revokeObjectURL(this.objectUrlToRevoke);
      this.objectUrlToRevoke = null;
    }
  }
}
