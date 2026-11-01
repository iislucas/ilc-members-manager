/* image-upload-preview.ts
 *
 * Component for uploading an image and previewing it with zoom and pan
 * to select a specific crop area. Supports zooming out (< 1x) to extend
 * transparent padding around the image, and Handles SVG intrinsic dimensions
 * as well as Firebase Storage SDK blob fetching to avoid CORS issues.
 * Outputs the cropped image as PNG Blobs.
 */

import {
  Component,
  ElementRef,
  ViewChild,
  signal,
  computed,
  output,
  input,
  effect,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { getStorage, ref as storageRef, getBlob } from 'firebase/storage';
import { IconComponent } from '../icons/icon.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { FIREBASE_APP } from '../app.config';

export type RatioKey = 'original' | '3:2' | '16:9' | '4:3' | '1:1';

export const MIN_ZOOM_SCALE = 0.2;
export const MAX_ZOOM_SCALE = 5;

@Component({
  selector: 'app-image-upload-preview',
  standalone: true,
  imports: [IconComponent, SpinnerComponent],
  templateUrl: './image-upload-preview.html',
  styleUrl: './image-upload-preview.scss',
})
export class ImageUploadPreviewComponent implements OnInit, OnDestroy {
  private firebaseApp = inject(FIREBASE_APP, { optional: true });

  @ViewChild('previewCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewImg', { static: false }) imgRef!: ElementRef<HTMLImageElement>;
  @ViewChild('container', { static: false }) containerRef!: ElementRef<HTMLDivElement>;

  readonly minScale = MIN_ZOOM_SCALE;
  readonly maxScale = MAX_ZOOM_SCALE;

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
  isLoadingImage = signal<boolean>(false);
  imageLoadError = signal<string | null>(null);
  useCrossOrigin = signal<boolean>(true);
  naturalRatio = signal<number | null>(null);
  intrinsicSize = signal<{ width: number; height: number } | null>(null);
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
      default: {
        const custom = this.customAspectRatio();
        if (custom !== undefined && custom !== null && custom > 0) return custom;
        const ratio = this.aspectRatio();
        if (ratio !== null && ratio > 0) return ratio;
        return this.naturalRatio() || 3 / 2;
      }
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
  scaleText = computed(() => this.scale().toFixed(2).replace(/\.?0+$/, (m) => (m === '.00' ? '.0' : m)));

  private objectUrlToRevoke: string | null = null;
  private loadRequestCounter = 0;

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
        void this.loadRemoteImage(url);
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

  private isFirebaseStorageUrl(url: string): boolean {
    return (
      url.includes('firebasestorage.googleapis.com/') ||
      url.includes('.firebasestorage.app/') ||
      url.includes('/v0/b/')
    );
  }

  // Ensures an SVG blob has explicit numeric width and height attributes on its root <svg>
  // element so that HTMLImageElement.naturalWidth/naturalHeight and canvas.drawImage()
  // behave reliably across all browsers (even when the uploaded SVG only specifies viewBox).
  private async normalizeImageBlob(blob: Blob, filenameHint?: string): Promise<Blob> {
    const isSvg =
      blob.type === 'image/svg+xml' ||
      (filenameHint && filenameHint.toLowerCase().endsWith('.svg'));
    if (!isSvg) {
      return blob;
    }

    try {
      const text = await blob.text();
      if (typeof DOMParser === 'undefined') {
        return new Blob([text], { type: 'image/svg+xml' });
      }
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = doc.documentElement;
      if (!svg || svg.tagName.toLowerCase() !== 'svg') {
        return new Blob([text], { type: 'image/svg+xml' });
      }

      const rawWidth = svg.getAttribute('width')?.trim() || '';
      const rawHeight = svg.getAttribute('height')?.trim() || '';
      const hasNumericWidth = rawWidth !== '' && !rawWidth.endsWith('%') && parseFloat(rawWidth) > 0;
      const hasNumericHeight = rawHeight !== '' && !rawHeight.endsWith('%') && parseFloat(rawHeight) > 0;

      if (!hasNumericWidth || !hasNumericHeight) {
        const viewBox = svg.getAttribute('viewBox');
        let vbWidth = 0;
        let vbHeight = 0;
        if (viewBox) {
          const parts = viewBox
            .trim()
            .split(/[\s,]+/)
            .map(Number);
          if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            vbWidth = parts[2];
            vbHeight = parts[3];
          }
        }
        const fallbackW = vbWidth > 0 ? vbWidth : this.largeDimensions().width || 600;
        const fallbackH = vbHeight > 0 ? vbHeight : this.largeDimensions().height || 600;
        if (!hasNumericWidth) {
          svg.setAttribute('width', String(fallbackW));
        }
        if (!hasNumericHeight) {
          svg.setAttribute('height', String(fallbackH));
        }
        const serialized = new XMLSerializer().serializeToString(doc);
        return new Blob([serialized], { type: 'image/svg+xml' });
      }
      return new Blob([text], { type: 'image/svg+xml' });
    } catch {
      return blob;
    }
  }

  private setBlobAsImageUrl(blob: Blob) {
    if (this.objectUrlToRevoke) {
      URL.revokeObjectURL(this.objectUrlToRevoke);
    }
    const blobUrl = URL.createObjectURL(blob);
    this.objectUrlToRevoke = blobUrl;
    this.useCrossOrigin.set(true);
    this.intrinsicSize.set(null);
    this.imageUrl.set(blobUrl);
  }

  private async loadRemoteImage(url: string): Promise<void> {
    const requestId = ++this.loadRequestCounter;
    this.imageLoadError.set(null);
    this.intrinsicSize.set(null);

    if (typeof window === 'undefined' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      this.useCrossOrigin.set(true);
      this.imageUrl.set(url);
      return;
    }

    this.isLoadingImage.set(true);
    try {
      let blob: Blob | null = null;

      // 1. Prefer Firebase Storage SDK getBlob() when applicable (uses Storage auth & avoids raw fetch failures).
      if (this.firebaseApp && this.isFirebaseStorageUrl(url)) {
        try {
          const storage = getStorage(this.firebaseApp);
          blob = await getBlob(storageRef(storage, url));
        } catch {
          blob = null;
        }
      }

      // 2. Fallback to standard CORS fetch.
      if (!blob && typeof fetch !== 'undefined') {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        blob = await res.blob();
      }

      if (requestId !== this.loadRequestCounter) return;

      if (blob) {
        const normalized = await this.normalizeImageBlob(blob, url);
        if (requestId !== this.loadRequestCounter) return;
        this.setBlobAsImageUrl(normalized);
        return;
      }

      this.useCrossOrigin.set(true);
      this.imageUrl.set(url);
    } catch {
      if (requestId !== this.loadRequestCounter) return;
      // If CORS blocks fetching the remote URL into a Blob, fall back to rendering
      // the <img> without `crossorigin="anonymous"` so the preview is still visible,
      // and explain if the user tries to export a tainted canvas without selecting a file.
      this.useCrossOrigin.set(false);
      this.imageUrl.set(url);
    } finally {
      if (requestId === this.loadRequestCounter) {
        this.isLoadingImage.set(false);
      }
    }
  }

  onImageError() {
    if (this.useCrossOrigin() && this.imageUrl()?.startsWith('http')) {
      // Retry rendering without CORS attribute so the image preview is at least visible.
      this.useCrossOrigin.set(false);
      return;
    }
    this.imageLoadError.set(
      'Unable to load the existing image for cropping. Please select an image file from your device.',
    );
  }

  isDragging = false;
  startX = 0;
  startY = 0;

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.selectedFile.set(file);
    this.imageLoadError.set(null);

    const normalized = await this.normalizeImageBlob(file, file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      this.useCrossOrigin.set(true);
      this.intrinsicSize.set(null);
      this.imageUrl.set(e.target?.result as string);
      this.resetTransform();
    };
    reader.readAsDataURL(normalized);
  }

  resetTransform() {
    this.scale.set(1);
    this.translateX.set(0);
    this.translateY.set(0);
  }

  private getEffectiveImageSize(
    img: HTMLImageElement,
    containerWidth: number,
    containerHeight: number,
  ): { width: number; height: number } | null {
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    const cached = this.intrinsicSize();
    if (cached && cached.width > 0 && cached.height > 0) {
      return cached;
    }
    if (img.width > 0 && img.height > 0) {
      return { width: img.width, height: img.height };
    }
    if (containerWidth > 0 && containerHeight > 0) {
      return { width: containerWidth, height: containerHeight };
    }
    const large = this.largeDimensions();
    if (large.width > 0 && large.height > 0) {
      return { width: large.width, height: large.height };
    }
    return null;
  }

  onImageLoad() {
    const img = this.imgRef?.nativeElement;
    const container = this.containerRef?.nativeElement;
    if (!img || !container) return;

    this.imageLoadError.set(null);

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    const size = this.getEffectiveImageSize(img, containerWidth, containerHeight);
    if (!size) return;

    this.intrinsicSize.set(size);
    this.naturalRatio.set(size.width / size.height);

    if (containerWidth === 0 || containerHeight === 0) {
      requestAnimationFrame(() => this.onImageLoad());
      return;
    }

    const scaleX = containerWidth / size.width;
    const scaleY = containerHeight / size.height;

    const fitScale = Math.max(scaleX, scaleY);
    this.baseScale.set(fitScale);

    const displayedWidth = size.width * fitScale * this.scale();
    const displayedHeight = size.height * fitScale * this.scale();

    this.translateX.set((containerWidth - displayedWidth) / 2);
    this.translateY.set((containerHeight - displayedHeight) / 2);
  }

  resetView() {
    this.scale.set(1);
    this.onImageLoad();
  }

  // Constrains translation on a single axis:
  // - When the scaled image is larger than the crop container (`displayed >= container`),
  //   keeps the container covered `[container - displayed, 0]` unless the user zooms out further.
  // - When the scaled image is smaller than the crop container (`displayed < container`, i.e. zoomed out),
  //   allows positioning the image anywhere inside `[0, container - displayed]`, leaving transparent
  //   padding around it.
  private clampAxis(pos: number, containerLen: number, displayedLen: number): number {
    if (displayedLen >= containerLen) {
      const minPos = containerLen - displayedLen;
      return Math.min(0, Math.max(minPos, pos));
    }
    const maxPos = containerLen - displayedLen;
    return Math.max(0, Math.min(maxPos, pos));
  }

  constrainTranslation(x: number, y: number): { x: number; y: number } {
    const img = this.imgRef?.nativeElement;
    const container = this.containerRef?.nativeElement;
    if (!img || !container) return { x, y };

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    const size = this.getEffectiveImageSize(img, containerWidth, containerHeight);
    if (!size) return { x, y };

    const displayedWidth = size.width * this.totalScale();
    const displayedHeight = size.height * this.totalScale();

    return {
      x: this.clampAxis(x, containerWidth, displayedWidth),
      y: this.clampAxis(y, containerHeight, displayedHeight),
    };
  }

  // Updates `scale` while keeping the focal point (default: center of the crop frame) stationary,
  // then clamps translation to valid bounds.
  private applyScaleWithAnchor(nextRawScale: number, anchorX?: number, anchorY?: number) {
    const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, nextRawScale));
    const prevTotal = this.totalScale();
    this.scale.set(clampedScale);
    const nextTotal = this.totalScale();

    const container = this.containerRef?.nativeElement;
    if (container && prevTotal > 0 && nextTotal > 0) {
      const rect = container.getBoundingClientRect();
      const cx = anchorX ?? rect.width / 2;
      const cy = anchorY ?? rect.height / 2;
      const ratio = nextTotal / prevTotal;
      const nextX = cx - (cx - this.translateX()) * ratio;
      const nextY = cy - (cy - this.translateY()) * ratio;
      const constrained = this.constrainTranslation(nextX, nextY);
      this.translateX.set(constrained.x);
      this.translateY.set(constrained.y);
    } else {
      const constrained = this.constrainTranslation(this.translateX(), this.translateY());
      this.translateX.set(constrained.x);
      this.translateY.set(constrained.y);
    }
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
    const constrained = this.constrainTranslation(
      event.clientX - this.startX,
      event.clientY - this.startY,
    );
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
      const constrained = this.constrainTranslation(
        touch.clientX - this.startX,
        touch.clientY - this.startY,
      );
      this.translateX.set(constrained.x);
      this.translateY.set(constrained.y);
    } else if (event.touches.length === 2 && this.initialPinchDistance > 0) {
      const t1 = event.touches[0];
      const t2 = event.touches[1];
      const currentDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const ratio = currentDist / this.initialPinchDistance;
      const container = this.containerRef?.nativeElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        const midX = (t1.clientX + t2.clientX) / 2 - rect.left;
        const midY = (t1.clientY + t2.clientY) / 2 - rect.top;
        this.applyScaleWithAnchor(this.initialPinchScale * ratio, midX, midY);
      } else {
        this.applyScaleWithAnchor(this.initialPinchScale * ratio);
      }
    }
  }

  onTouchEnd() {
    this.isDragging = false;
    this.initialPinchDistance = 0;
  }

  onWheel(event: WheelEvent) {
    if (!this.imageUrl()) return;
    event.preventDefault();
    const step = this.scale() <= 1 ? 0.05 : 0.1;
    const delta = event.deltaY > 0 ? -step : step;
    const container = this.containerRef?.nativeElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      const anchorY = event.clientY - rect.top;
      this.applyScaleWithAnchor(this.scale() + delta, anchorX, anchorY);
    } else {
      this.applyScaleWithAnchor(this.scale() + delta);
    }
  }

  onZoomChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.applyScaleWithAnchor(parseFloat(input.value));
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

  // Draws the cropped/zoomed view onto `ctx` (sized `destW` x `destH`), preserving transparent
  // regions outside the image bounds when zoomed out (`scale < 1`).
  // Uses destination-coordinate drawing rather than negative source coordinates (`sx < 0` or `sy < 0`),
  // because HTML5 Canvas `drawImage(img, sx, sy, sw, sh, ...)` clamps or fails across browsers when
  // the source rectangle extends outside `[0, intrinsicWidth] x [0, intrinsicHeight]`, or when `img`
  // is an SVG without natural pixel dimensions.
  private drawTransformedImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    containerWidth: number,
    containerHeight: number,
    destWidth: number,
    destHeight: number,
  ) {
    ctx.clearRect(0, 0, destWidth, destHeight);

    const size = this.getEffectiveImageSize(img, containerWidth, containerHeight);
    if (!size) return;

    const safeContainerW = containerWidth > 0 ? containerWidth : destWidth;
    const safeContainerH = containerHeight > 0 ? containerHeight : destHeight;

    const scaleToDestX = destWidth / safeContainerW;
    const scaleToDestY = destHeight / safeContainerH;

    const dx = this.translateX() * scaleToDestX;
    const dy = this.translateY() * scaleToDestY;
    const dw = size.width * this.totalScale() * scaleToDestX;
    const dh = size.height * this.totalScale() * scaleToDestY;

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  async applyCrop() {
    const img = this.imgRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const container = this.containerRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.imageLoadError.set(null);

    const rect = container.getBoundingClientRect();
    const containerWidth = rect.width;
    const containerHeight = rect.height;

    const thumb = this.thumbDimensions();
    const activeRatio = this.resolvedAspectRatio();
    const thumbHeight = Math.max(1, Math.round(thumb.width / activeRatio));
    canvas.width = thumb.width;
    canvas.height = thumbHeight;
    this.drawTransformedImage(ctx, img, containerWidth, containerHeight, thumb.width, thumbHeight);

    let thumbBlob: Blob;
    let largeBlob: Blob;
    try {
      thumbBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to export thumbnail canvas to blob'));
        }, 'image/png');
      });

      const large = this.largeDimensions();
      const largeHeight = Math.max(1, Math.round(large.width / activeRatio));
      canvas.width = large.width;
      canvas.height = largeHeight;
      this.drawTransformedImage(ctx, img, containerWidth, containerHeight, large.width, largeHeight);
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
      this.imageLoadError.set(
        'Cannot re-crop this remote image directly due to browser cross-origin restrictions. Please click "Choose Different Image" to upload the image file from your device.',
      );
      return;
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
    this.imageLoadError.set(null);
    this.cancel.emit();
  }

  ngOnDestroy() {
    if (this.objectUrlToRevoke) {
      URL.revokeObjectURL(this.objectUrlToRevoke);
      this.objectUrlToRevoke = null;
    }
  }
}
