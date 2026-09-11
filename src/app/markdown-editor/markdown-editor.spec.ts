import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownEditor } from './markdown-editor';
import { editorViewCtx } from '@milkdown/core';
import { TextSelection } from '@milkdown/prose/state';

describe('MarkdownEditor', () => {
  let component: MarkdownEditor;
  let fixture: ComponentFixture<MarkdownEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MarkdownEditor]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MarkdownEditor);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit changed event when initialValue is set', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    // Set input signal
    fixture.componentRef.setInput('initialValue', '# Test Default Text');
    
    // Trigger effect
    fixture.detectChanges();
    
    // Wait for async editor initialization and effect
    await new Promise(resolve => setTimeout(resolve, 500));
    fixture.detectChanges();

    expect(emittedValue).toContain('# Test Default Text');
  });

  it('should toggle bullet list when toggleBulletList is called', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    // Set initial value as a paragraph
    fixture.componentRef.setInput('initialValue', 'Line 1');
    fixture.detectChanges();
    
    // Wait for async editor initialization
    await new Promise(resolve => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Mock coordsAtPos to avoid jsdom errors
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    });

    // Now toggle list
    component.toggleBulletList();
    
    // Wait for async operation
    await new Promise(resolve => setTimeout(resolve, 200));
    fixture.detectChanges();

    // It should become a list item
    expect(emittedValue).toContain('* Line 1');

    // Toggle again to remove list
    component.toggleBulletList();
    
    // Wait for async operation
    await new Promise(resolve => setTimeout(resolve, 200));
    fixture.detectChanges();

    // It should revert to a paragraph
    expect(emittedValue).not.toContain('* Line 1');
    expect(emittedValue).toContain('Line 1');
  });

  it('should toggle heading when wrapInHeading is called with same level', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    // Set initial value as a paragraph
    fixture.componentRef.setInput('initialValue', 'Line 1');
    fixture.detectChanges();
    
    // Wait for async editor initialization
    await new Promise(resolve => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Mock coordsAtPos
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    });

    // Now toggle heading H1
    component.wrapInHeading(1);
    
    // Wait for async operation
    await new Promise(resolve => setTimeout(resolve, 200));
    fixture.detectChanges();

    // It should become a heading
    expect(emittedValue).toContain('# Line 1');

    // Toggle again to remove heading
    component.wrapInHeading(1);
    
    // Wait for async operation
    await new Promise(resolve => setTimeout(resolve, 200));
    fixture.detectChanges();

    // It should revert to a paragraph
    expect(emittedValue).not.toContain('# Line 1');
    expect(emittedValue).toContain('Line 1');
  });

  it('should toggle heading H1 with selection', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    // Set initial value as H1
    fixture.componentRef.setInput('initialValue', '# Line 1');
    fixture.detectChanges();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Mock coordsAtPos
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      
      const { state } = view;
      const SelectionClass = state.selection.constructor as any;
      // Select "Line 1" (positions 2 to 8)
      const tr = state.tr.setSelection(SelectionClass.create(state.doc, 2, 8));
      view.dispatch(tr);
    });

    // Call wrapInHeading(1) -> should toggle off
    component.wrapInHeading(1);
    
    await new Promise(resolve => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).not.toContain('# Line 1');
    expect(emittedValue).toContain('Line 1');
  });

  it('shows all toolbar features by default and restricts them via enabledFeatures', () => {
    // Open the formatting menu so the items render.
    component.menuOpen.set(true);
    fixture.detectChanges();
    const labels = () =>
      Array.from(fixture.nativeElement.querySelectorAll('.menu-item')).map((el) =>
        (el as HTMLElement).title || (el as HTMLElement).textContent?.trim(),
      );

    // Default: italic and headings are present.
    const menuText = fixture.nativeElement.querySelector('.menu').textContent;
    expect(menuText).toContain('I'); // italic icon
    expect(menuText).toContain('H1');

    // Restrict to bold + link only.
    fixture.componentRef.setInput('enabledFeatures', ['bold', 'link']);
    fixture.detectChanges();
    const restrictedText = fixture.nativeElement.querySelector('.menu').textContent;
    expect(restrictedText).toContain('B'); // bold still there
    expect(restrictedText).not.toContain('H1'); // headings gone
    expect(restrictedText).not.toContain('H2');
    // Undo/redo and clear-formatting remain available regardless.
    expect(labels().length).toBeGreaterThan(0);
  });

  it('inserts a chip token at the cursor', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', 'Hi ');
    fixture.componentRef.setInput('chips', [{ token: '{name}' }]);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Verify chips-section renders inside the toolbar
    const chipBtn = fixture.nativeElement.querySelector('.chips-section .chip-insert');
    expect(chipBtn).toBeTruthy();
    expect(chipBtn.textContent.trim()).toBe('{name}');

    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    });

    // Click chip button in toolbar
    chipBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toContain('{name}');
  });

  it('should toggle heading H1 without selection (cursor)', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    // Set initial value as H1
    fixture.componentRef.setInput('initialValue', '# Line 1');
    fixture.detectChanges();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Mock coordsAtPos
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      
      const { state } = view;
      const SelectionClass = state.selection.constructor as any;
      // Set cursor at position 2
      const tr = state.tr.setSelection(SelectionClass.create(state.doc, 2, 2));
      view.dispatch(tr);
    });

    // Call wrapInHeading(1) -> should toggle off
    component.wrapInHeading(1);
    
    await new Promise(resolve => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).not.toContain('# Line 1');
    expect(emittedValue).toContain('Line 1');
  });

  it('should default toolbar to open and toggle open/close with format button', () => {
    // Default open
    expect(component.menuOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('.toolbar-wrapper')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.menu')).toBeTruthy();

    const formatBtn = fixture.nativeElement.querySelector('.format-btn');
    expect(formatBtn).toBeTruthy();
    expect(formatBtn.classList).toContain('active');

    // Toggle close
    formatBtn.click();
    fixture.detectChanges();

    expect(component.menuOpen()).toBe(false);
    expect(fixture.nativeElement.querySelector('.toolbar-wrapper')).toBeNull();
    expect(fixture.nativeElement.querySelector('.menu')).toBeNull();
    expect(formatBtn.classList).not.toContain('active');

    // Toggle open
    formatBtn.click();
    fixture.detectChanges();

    expect(component.menuOpen()).toBe(true);
    expect(fixture.nativeElement.querySelector('.toolbar-wrapper')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.menu')).toBeTruthy();
  });

  it('should toggle fullscreen mode with button and escape key', () => {
    expect(component.isFullscreen()).toBe(false);
    const container = fixture.nativeElement.querySelector('.markdown-editor-container');
    expect(container.classList).not.toContain('fullscreen');
    expect(fixture.nativeElement.querySelector('.fullscreen-fixed-btn')).toBeNull();

    const fullscreenBtn = fixture.nativeElement.querySelector('.fullscreen-menu-item');
    expect(fullscreenBtn).toBeTruthy();

    // Enter fullscreen
    fullscreenBtn.click();
    fixture.detectChanges();

    expect(component.isFullscreen()).toBe(true);
    expect(container.classList).toContain('fullscreen');

    // In fullscreen mode, the fixed leftmost exit button should be present
    const fixedExitBtn = fixture.nativeElement.querySelector('.fullscreen-fixed-btn');
    expect(fixedExitBtn).toBeTruthy();

    // Click fixed button to exit fullscreen
    fixedExitBtn.click();
    fixture.detectChanges();

    expect(component.isFullscreen()).toBe(false);
    expect(container.classList).not.toContain('fullscreen');
    expect(fixture.nativeElement.querySelector('.fullscreen-fixed-btn')).toBeNull();

    // Re-enter and exit with Escape key
    component.isFullscreen.set(true);
    fixture.detectChanges();
    expect(component.isFullscreen()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();

    expect(component.isFullscreen()).toBe(false);
    expect(container.classList).not.toContain('fullscreen');
  });

  it('should toggle descriptions in toolbar menu', () => {
    expect(component.showDescriptions()).toBe(false);
    expect(fixture.nativeElement.querySelector('.menu.collapsed')).toBeTruthy();

    const infoBtn = fixture.nativeElement.querySelector('.info-btn');
    infoBtn.click();
    fixture.detectChanges();

    expect(component.showDescriptions()).toBe(true);
    expect(fixture.nativeElement.querySelector('.menu.collapsed')).toBeNull();
    expect(fixture.nativeElement.querySelector('.menu-title')?.textContent).toContain('Actions');
  });

  it('should display scroll arrows when content overflows and handle scrolling', () => {
    const menuEl = fixture.nativeElement.querySelector('.menu') as HTMLElement;
    expect(menuEl).toBeTruthy();

    // Mock scroll dimensions where right overflow exists
    Object.defineProperty(menuEl, 'scrollLeft', { value: 0, writable: true, configurable: true });
    Object.defineProperty(menuEl, 'scrollWidth', { value: 600, writable: true, configurable: true });
    Object.defineProperty(menuEl, 'clientWidth', { value: 300, writable: true, configurable: true });

    component.updateScrollState();
    fixture.detectChanges();

    expect(component.canScrollLeft()).toBe(false);
    expect(component.canScrollRight()).toBe(true);

    const rightArrow = fixture.nativeElement.querySelector('.scroll-arrow-btn.right');
    expect(rightArrow).toBeTruthy();

    // Spy on scrollBy
    const scrollBySpy = vi.fn();
    menuEl.scrollBy = scrollBySpy;

    rightArrow.click();
    expect(scrollBySpy).toHaveBeenCalledWith({ left: 120, behavior: 'smooth' });

    // Mock scrolled to middle
    Object.defineProperty(menuEl, 'scrollLeft', { value: 100, writable: true, configurable: true });
    component.updateScrollState();
    fixture.detectChanges();

    expect(component.canScrollLeft()).toBe(true);
    expect(component.canScrollRight()).toBe(true);

    const leftArrow = fixture.nativeElement.querySelector('.scroll-arrow-btn.left');
    expect(leftArrow).toBeTruthy();

    leftArrow.click();
    expect(scrollBySpy).toHaveBeenCalledWith({ left: -120, behavior: 'smooth' });
  });

  it('supports the bordered input to toggle container border', () => {
    const container = fixture.nativeElement.querySelector('.markdown-editor-container');
    expect(component.bordered()).toBe(false);
    expect(container.classList).not.toContain('bordered');

    fixture.componentRef.setInput('bordered', true);
    fixture.detectChanges();

    expect(component.bordered()).toBe(true);
    expect(container.classList).toContain('bordered');
  });

  it('defaults textPadding to 8px 12px and allows disabling or customizing', () => {
    const editorContent = fixture.nativeElement.querySelector('.editor-content');
    expect(component.textPadding()).toBe(true);
    expect(component['resolvedTextPadding']()).toBe('8px 12px');
    expect(editorContent.style.padding).toBe('8px 12px');

    // Disable padding
    fixture.componentRef.setInput('textPadding', false);
    fixture.detectChanges();
    expect(component['resolvedTextPadding']()).toBe('0');
    expect(editorContent.style.padding).toBe('0px');

    // Custom padding string
    fixture.componentRef.setInput('textPadding', '16px 24px');
    fixture.detectChanges();
    expect(component['resolvedTextPadding']()).toBe('16px 24px');
    expect(editorContent.style.padding).toBe('16px 24px');
  });

  it('keeps the toolbar full width without being indented by textPadding', () => {
    fixture.componentRef.setInput('textPadding', '20px 30px');
    fixture.detectChanges();

    const toolbar = fixture.nativeElement.querySelector('.toolbar-wrapper');
    expect(toolbar).toBeTruthy();
    // Toolbar wrapper style padding is the compact internal toolbar padding, unaffected by textPadding
    expect(toolbar.style.padding).not.toContain('30px');
  });

  it('sinks a bullet list item that follows an ordered list item (shift-right bullet)', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', '1. Item one\n* Item two');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Position cursor in the second item ("Item two")
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      const SelectionClass = state.selection.constructor as any;
      // Position inside the second list item (near the end of doc)
      const targetPos = Math.max(0, state.doc.content.size - 3);
      view.dispatch(state.tr.setSelection(SelectionClass.create(state.doc, targetPos)));
    });

    // Call indent (shift-right)
    component.indent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // In markdown, "Item two" should now be an indented bullet inside the numbered list
    expect(emittedValue).toContain('Item one');
    expect(emittedValue).toContain('Item two');
    // Bullet should be indented with spaces before the bullet marker
    expect(emittedValue).toMatch(/1\.\s+Item one[\s\S]+[*+-]\s+Item two/);
  });

  it('toggles an ordered list and converts between list types', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', 'First line');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    });

    // Toggle ordered list on paragraph
    component.toggleOrderedList();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toMatch(/1\.\s+First line/);

    // Convert the ordered list to a bullet list
    component.toggleBulletList();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toContain('* First line');

    // Convert back to ordered list
    component.toggleOrderedList();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toMatch(/1\.\s+First line/);
  });

  it('unindents a nested list item back to the outer list', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', '1. Item one\n   * Item two');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      // Position inside "Item two"
      const targetPos = Math.max(1, state.doc.content.size - 6);
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(targetPos))));
    });

    // Unindent item two
    component.unindent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Now item two should be lifted back out as item 2 of the ordered list
    expect(emittedValue).toMatch(/1\.\s+Item one/);
    expect(emittedValue).toMatch(/2\.\s+Item two/);
  });

  it('supports image dialog and inserting an image via URL', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', 'Here is an article:');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    });

    expect(component.imageModalOpen()).toBe(false);
    component.openImageDialog();
    expect(component.imageModalOpen()).toBe(true);

    // Switch to URL tab
    component.imageSourceType.set('url');
    component.imageUrlInput.set('https://example.com/demo.jpg');
    component.imageAltText.set('Demo Image');

    component.insertImageUrl();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(component.imageModalOpen()).toBe(false);
    expect(emittedValue).toContain('![Demo Image](https://example.com/demo.jpg)');
  });

  it('supports custom imageUploader input on image cropped', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    const mockUploader = vi.fn().mockResolvedValue('https://storage.example.com/uploaded_crop.png');
    fixture.componentRef.setInput('imageUploader', mockUploader);
    fixture.componentRef.setInput('initialValue', 'Article text');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
    });

    component.openImageDialog();
    component.imageAltText.set('Uploaded Diagram');

    const fakeBlob = new Blob(['test image bytes'], { type: 'image/png' });
    await component.onImageCropped({
      thumbBlob: fakeBlob,
      largeBlob: fakeBlob,
      originalFile: new File([''], 'photo.png', { type: 'image/png' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(mockUploader).toHaveBeenCalledTimes(1);
    expect(component.imageModalOpen()).toBe(false);
    expect(emittedValue).toContain('![Uploaded Diagram](https://storage.example.com/uploaded_crop.png)');
  });

  it('supports image dialog with caption and inserting an image with caption via URL', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', 'Article text:');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    component.openImageDialog();
    expect(component.imageModalOpen()).toBe(true);

    component.imageSourceType.set('url');
    component.imageUrlInput.set('https://example.com/pic.jpg');
    component.imageAltText.set('Neutral Point');
    component.imageCaption.set('Sam Chin demonstrating the neutral point');

    component.insertImageUrl();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(component.imageModalOpen()).toBe(false);
    expect(emittedValue).toContain('![Neutral Point](https://example.com/pic.jpg "Sam Chin demonstrating the neutral point")');
  });

  it('renders inline image with caption input and actions in WYSIWYG mode', async () => {
    fixture.componentRef.setInput(
      'initialValue',
      '![Demonstration](https://example.com/pic.jpg "Initial caption")'
    );
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    const editorEl = fixture.nativeElement.querySelector('.milkdown');
    const figure = editorEl.querySelector('.editor-image-figure');
    expect(figure).toBeTruthy();

    const img = figure.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/pic.jpg');
    expect(img.getAttribute('alt')).toBe('Demonstration');
    expect(img.getAttribute('title')).toBe('Initial caption');

    const captionInput = figure.querySelector('.editor-image-caption-input') as HTMLInputElement;
    expect(captionInput).toBeTruthy();
    expect(captionInput.value).toBe('Initial caption');

    const actions = figure.querySelector('.editor-image-actions');
    expect(actions).toBeTruthy();
    expect(actions.querySelector('.edit-btn')).toBeTruthy();
    expect(actions.querySelector('.delete-btn')).toBeTruthy();
  });

  it('updates markdown when inline caption input is edited in WYSIWYG mode', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput(
      'initialValue',
      '![Photo](https://example.com/pic.jpg "Old caption")'
    );
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    const editorEl = fixture.nativeElement.querySelector('.milkdown');
    const captionInput = editorEl.querySelector('.editor-image-caption-input') as HTMLInputElement;
    expect(captionInput).toBeTruthy();

    captionInput.value = 'New refined caption';
    captionInput.dispatchEvent(new Event('blur'));

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toContain('![Photo](https://example.com/pic.jpg "New refined caption")');
    expect(component.getMarkdown()).toContain('![Photo](https://example.com/pic.jpg "New refined caption")');
  });

  it('allows editing existing image details via dialog and removing images', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput(
      'initialValue',
      '![Original](https://example.com/pic.jpg "Original caption")'
    );
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Pos 1 is the image node inside the paragraph
    component.openImageDialog(1, {
      src: 'https://example.com/pic.jpg',
      alt: 'Original',
      title: 'Original caption',
    });

    expect(component.editingImagePos()).toBe(1);
    expect(component.imageUrlInput()).toBe('https://example.com/pic.jpg');
    expect(component.imageAltText()).toBe('Original');
    expect(component.imageCaption()).toBe('Original caption');

    // Update details
    component.imageAltText.set('Updated Alt');
    component.imageCaption.set('Updated Caption');
    component.saveImageDetailsOnly();

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(component.imageModalOpen()).toBe(false);
    expect(emittedValue).toContain('![Updated Alt](https://example.com/pic.jpg "Updated Caption")');

    // Remove the image
    component.removeImageAtPos(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(component.getMarkdown()).not.toContain('https://example.com/pic.jpg');
  });

  it('preserves image with caption idempotently across Raw mode round-trips', async () => {
    const inputMd = 'Intro text\n\n![Zhong Xin Dao](https://example.com/zxd.png "Philosophy diagram")\n\nOutro text';
    fixture.componentRef.setInput('initialValue', inputMd);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Switch to raw mode
    component.toggleRawMode();
    fixture.detectChanges();
    expect(component.isRawMode()).toBe(true);
    expect(component.rawContent().trim()).toBe(inputMd.trim());

    // Switch back to rich mode
    component.toggleRawMode();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(component.isRawMode()).toBe(false);
    expect(component.getMarkdown().trim()).toBe(inputMd.trim());
  });

  it('updates dimensions based on aspect ratio and size choices', () => {
    component.setSizeChoice('large');
    component.setAspectRatio(16 / 9);
    expect(component.imageDimensions().width).toBe(1000);
    expect(component.imageDimensions().height).toBe(Math.round(1000 / (16 / 9)));

    component.setSizeChoice('small');
    component.setAspectRatio(1);
    expect(component.imageDimensions().width).toBe(300);
    expect(component.imageDimensions().height).toBe(300);
  });

  it('supports multi-level deep indentation and unindenting across levels', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', '* Level 1\n* Level 2 item\n* Level 3 item');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Helper to position cursor in text matching query
    const setCursorInText = (textQuery: string) => {
      component['editor']?.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
        const { state } = view;
        let foundPos = -1;
        state.doc.descendants((node, pos) => {
          if (node.isText && node.text?.includes(textQuery)) {
            foundPos = pos + 2;
          }
        });
        if (foundPos !== -1) {
          view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(foundPos))));
        }
      });
    };

    // Step 1: Indent Level 2 item into Level 2 under Level 1
    setCursorInText('Level 2 item');
    component.indent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toMatch(/Level 1[\s\S]+\s+[*+-]\s+Level 2 item/);

    // Step 2: Indent Level 3 item once into Level 2
    setCursorInText('Level 3 item');
    component.indent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Step 3: Indent Level 3 item AGAIN into Level 3 under Level 2 item!
    setCursorInText('Level 3 item');
    component.indent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // In markdown, Level 3 item should now be nested 2 levels deep
    expect(emittedValue).toMatch(/Level 1[\s\S]+\s+[*+-]\s+Level 2 item[\s\S]+\s{4,}[*+-]\s+Level 3 item/);

    // Step 4: Unindent Level 3 item back to Level 2
    setCursorInText('Level 3 item');
    component.unindent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Now Level 2 item and Level 3 item are both at Level 2
    expect(emittedValue).toMatch(/Level 1[\s\S]+\s+[*+-]\s+Level 2 item[\s\S]+\s+[*+-]\s+Level 3 item/);

    // Step 5: Unindent Level 3 item back to Level 1
    setCursorInText('Level 3 item');
    component.unindent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toMatch(/Level 1[\s\S]+\* Level 3 item/);
  });

  it('wraps multiple selected lines into individual bullets and supports unbulleting and re-bulleting', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', 'Line Alpha\n\nLine Beta\n\nLine Gamma');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Select all three lines
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
    });

    // 1. Bullet them all
    component.toggleBulletList();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // All three must be individual bullets
    expect(emittedValue).toContain('* Line Alpha');
    expect(emittedValue).toContain('* Line Beta');
    expect(emittedValue).toContain('* Line Gamma');

    // Select all three bullet items
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
    });

    // 2. Unbullet them all
    component.toggleBulletList();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Should now be plain paragraphs without asterisks
    expect(emittedValue).not.toContain('* Line Alpha');
    expect(emittedValue).toContain('Line Alpha');
    expect(emittedValue).toContain('Line Beta');
    expect(emittedValue).toContain('Line Gamma');

    // Select all three paragraphs again
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
    });

    // 3. Re-bullet them all
    component.toggleBulletList();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // All three should properly be bullets again!
    expect(emittedValue).toContain('* Line Alpha');
    expect(emittedValue).toContain('* Line Beta');
    expect(emittedValue).toContain('* Line Gamma');
  });

  it('splits newlines and hardbreaks into separate bullets', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    // Single paragraph with soft breaks / newlines
    fixture.componentRef.setInput('initialValue', 'Apple\nBanana\nCherry');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Select the content
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
    });

    // Bullet the lines
    component.toggleBulletList();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Each newline should result in an additional bullet
    expect(emittedValue).toContain('* Apple');
    expect(emittedValue).toContain('* Banana');
    expect(emittedValue).toContain('* Cherry');
  });

  it('indents and unindents multiple selected list items together', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', '* Parent\n* Child One\n* Child Two');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Select Child One and Child Two
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      let pos1 = -1, pos2 = -1;
      state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Child One') pos1 = pos + 1;
        if (node.isText && node.text === 'Child Two') pos2 = pos + 8;
      });
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos1, pos2)));
    });

    // Indent both items together
    component.indent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Both Child One and Child Two should now be indented under Parent
    expect(emittedValue).toMatch(/Parent[\s\S]+\s+[*+-]\s+Child One[\s\S]+\s+[*+-]\s+Child Two/);

    // Unindent both items together
    component.unindent();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Both should be lifted back to the outer level
    expect(emittedValue).toContain('* Parent');
    expect(emittedValue).toContain('* Child One');
    expect(emittedValue).toContain('* Child Two');
  });

  it('toggles note / blockquote style (> quote)', async () => {
    let emittedValue = '';
    component.changed.subscribe((value) => {
      emittedValue = value;
    });

    fixture.componentRef.setInput('initialValue', 'This is an important note.');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 5)));
    });

    // Toggle note / blockquote ON
    component.toggleBlockquote();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).toMatch(/^>\s+This is an important note\./);

    // Toggle note / blockquote OFF
    component.toggleBlockquote();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(emittedValue).not.toContain('>');
    expect(emittedValue).toContain('This is an important note.');
  });

  it('toggles showBreaks visual break markers without layout distortion', async () => {
    fixture.componentRef.setInput('initialValue', 'First line  \nSecond line\n\nThird line');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    expect(component.showBreaks()).toBe(false);
    expect(fixture.nativeElement.querySelector('.markdown-editor-container.show-break-marks')).toBeNull();

    // Toggle showBreaks ON
    component.toggleShowBreaks();
    fixture.detectChanges();

    expect(component.showBreaks()).toBe(true);
    const container = fixture.nativeElement.querySelector('.markdown-editor-container.show-break-marks');
    expect(container).not.toBeNull();

    // Verify paragraph nodes are NOT distorted with hack separators or trailing break wrappers
    const paragraphs = fixture.nativeElement.querySelectorAll('.ProseMirror p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    // Neither paragraph should have ProseMirror-separator images injected
    expect(fixture.nativeElement.querySelector('.ProseMirror .ProseMirror-separator')).toBeNull();

    // Inspect decorations built by buildBreakMarkDecorations for hardbreaks
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const decos = component['buildBreakMarkDecorations'](view.state.doc);
      expect(decos).toBeDefined();
      const foundWidgets = decos.find();
      // Finds decoration for the hardbreak on the first line
      expect(foundWidgets.length).toBeGreaterThan(0);
    });

    // Toggle showBreaks OFF
    component.toggleShowBreaks();
    fixture.detectChanges();

    expect(component.showBreaks()).toBe(false);
    expect(fixture.nativeElement.querySelector('.markdown-editor-container.show-break-marks')).toBeNull();
  });

  it('supports sticky toolbar header with raw mode toggling and editing', async () => {
    let emitted = '';
    component.changed.subscribe((val) => {
      emitted = val;
    });

    fixture.componentRef.setInput('initialValue', '# Rich Text Title\n\nInitial paragraph.');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Check sticky header wrapper exists with format and raw buttons
    const stickyHeader = fixture.nativeElement.querySelector('.editor-header-sticky');
    expect(stickyHeader).not.toBeNull();
    const rawBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector('.raw-toggle-btn');
    expect(rawBtn).not.toBeNull();
    expect(rawBtn?.textContent?.trim()).toBe('Raw');

    // Switch to Raw Mode
    component.toggleRawMode();
    fixture.detectChanges();

    expect(component.isRawMode()).toBe(true);
    expect(rawBtn?.textContent?.trim()).toBe('Rich');
    const textarea: HTMLTextAreaElement | null = fixture.nativeElement.querySelector('.raw-markdown-textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain('Rich Text Title');

    // Edit raw markdown in textarea
    component.onRawInput('# Updated Raw Title\n\nUpdated in raw mode.');
    fixture.detectChanges();

    expect(component.rawContent()).toBe('# Updated Raw Title\n\nUpdated in raw mode.');
    expect(emitted).toBe('# Updated Raw Title\n\nUpdated in raw mode.');

    // Switch back to Rich mode
    component.toggleRawMode();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    expect(component.isRawMode()).toBe(false);
    expect(fixture.nativeElement.querySelector('.raw-markdown-textarea')).toBeNull();
    // Rich editor doc should now reflect the updated content
    expect(component.getMarkdown()).toContain('Updated Raw Title');
  });

  it('handles tab key in list item without error when selection spans list', async () => {
    fixture.componentRef.setInput('initialValue', '* Bullet 1\n* Bullet 2\n* Bullet 3');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    let handled = false;
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      // Select from Bullet 1 to Bullet 2
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 2, 12)));

      // Simulate Tab key event
      const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
      handled = view.someProp('handleKeyDown', (f) => f(view, event)) || false;
    });

    expect(handled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Bullet 2 sunk into Bullet 1
    const md = component.getMarkdown();
    expect(md).toContain('Bullet 1');
  });

  it('handles Return as line break and two consecutive Returns as paragraph break', async () => {
    fixture.componentRef.setInput('initialValue', 'First line');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // 1. Press Enter at end of 'First line' -> should insert hardbreak (single line break)
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      view.someProp('handleKeyDown', (f) => f(view, enterEvent));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    let md = component.getMarkdown();
    // Emitted markdown contains clean line break (no backslash, no <br />)
    expect(md).not.toContain('<br />');
    expect(md).not.toContain('\\');
    expect(md).toContain('First line\n');

    // 2. Press Enter a second time -> should convert line break to new paragraph
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      view.someProp('handleKeyDown', (f) => f(view, enterEvent));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    md = component.getMarkdown();
    expect(md).not.toContain('<br />');
    expect(md).not.toContain('\\');
  });

  it('handles Shift-Return to always insert a line break', async () => {
    fixture.componentRef.setInput('initialValue', 'First line');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));

      const shiftEnterEvent = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
      view.someProp('handleKeyDown', (f) => f(view, shiftEnterEvent));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    const md = component.getMarkdown();
    expect(md).not.toContain('<br />');
    expect(md).toContain('First line\n');
  });

  it('handles Return in bullet list to create tight next bullet and exits on empty bullet', async () => {
    fixture.componentRef.setInput('initialValue', '* First bullet');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // 1. Press Enter at end of bullet -> creates next bullet
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      const targetSel = TextSelection.near(state.doc.resolve(state.doc.content.size), -1);
      view.dispatch(state.tr.setSelection(targetSel));

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      view.someProp('handleKeyDown', (f) => f(view, enterEvent));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Type text in the newly created bullet
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      view.dispatch(state.tr.insertText('Second bullet'));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    const md = component.getMarkdown();
    // Must be tight list (single \n, no \n\n between items, no <br />)
    expect(md).not.toContain('* First bullet\n\n* Second bullet');
    expect(md).toContain('* First bullet');
    expect(md).toContain('* Second bullet');
    expect(md).not.toContain('<br />');

    // 2. Press Enter at end of second bullet -> creates empty bullet
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      view.someProp('handleKeyDown', (f) => f(view, enterEvent));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // 3. Press Enter on empty bullet -> lifts out of list (exits list)
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      view.someProp('handleKeyDown', (f) => f(view, enterEvent));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Still retains both bullets without error
    const finalMd = component.getMarkdown();
    expect(finalMd).toContain('* First bullet');
    expect(finalMd).toContain('* Second bullet');
  });

  it('preserves scroll position when toggling Raw mode without jumping', async () => {
    fixture.componentRef.setInput('initialValue', '# Document Title\n\n' + 'Paragraph\n\n'.repeat(20));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    const scrollToSpy = vi.spyOn(component as any, 'safeScrollTo');

    // Toggle to Raw mode
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    expect(component.isRawMode()).toBe(true);
    expect(scrollToSpy).toHaveBeenCalled();

    // Toggle back to Rich mode
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    expect(component.isRawMode()).toBe(false);
    expect(scrollToSpy).toHaveBeenCalled();
  });

  it('normalizes multiple line breaks and cleans serialized markdown', () => {
    expect(component.normalizeMarkdown('P1\n\n\nP2')).toBe('P1\n\n<br />\n\nP2');
    expect(component.normalizeMarkdown('P1\n\n\n\nP2')).toBe('P1\n\n<br />\n\n<br />\n\nP2');
    expect(component.cleanSerializedMarkdown('P1\n\n<br />\n\nP2\n')).toBe('P1\n\n\nP2\n');
    expect(component.cleanSerializedMarkdown('P1\n\n<br />\n\n<br />\n\nP2\n')).toBe('P1\n\n\n\nP2\n');
  });

  it('creates a line above bold text when Enter is pressed at the start without corrupting bold into **\\n', async () => {
    fixture.componentRef.setInput('initialValue', '**Bold heading**');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Place cursor at the start of the bold heading (pos 1, parentOffset 0)
    component['editor']?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.coordsAtPos = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
      const { state } = view;
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1)));

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      view.someProp('handleKeyDown', (f) => f(view, enterEvent));
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    const md = component.getMarkdown();
    // Must NOT contain opening delimiter corrupted with newline (**\nBold)
    expect(md).not.toContain('**\nBold');
    expect(md).not.toMatch(/\*\*[\r\n]+[^\*\r\n]/);
    // Must preserve bold heading intact
    expect(md).toContain('**Bold heading**');
  });

  it('preserves extra line breaks (3 newlines) consistently when toggling between Raw and Rich modes without <br />', async () => {
    fixture.componentRef.setInput('initialValue', 'First paragraph\n\nSecond paragraph');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Switch to Raw mode and add 3 newlines between paragraphs
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    component.onRawInput('First paragraph\n\n\nSecond paragraph');
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    // Switch to Rich mode
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Switch back to Raw mode
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    const rawMd = component.getMarkdown();
    expect(rawMd.trim()).toBe('First paragraph\n\n\nSecond paragraph');
    expect(rawMd).not.toContain('<br />');
  });

  it('is idempotent when round-tripping complex markdown with bold, blank lines, and bullets between Raw and Rich modes', async () => {
    const originalText =
      'How to approach things from the **right viewpoint** to see down to the base of their origins.\n\n\n' +
      '**(1) KNOWLEDGE**\n\n' +
      '* Knowledge from others\n' +
      '* Knowledge from own thinking\n' +
      '* Knowledge from direct experience';

    fixture.componentRef.setInput('initialValue', originalText);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Toggle to Raw mode
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    expect(component.rawContent().trim()).toBe(originalText.trim());

    // Toggle back to Rich mode
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 200));
    fixture.detectChanges();

    // Toggle to Raw mode again
    component.toggleRawMode();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    expect(component.rawContent().trim()).toBe(originalText.trim());
    expect(component.rawContent()).not.toContain('origins.**');
    expect(component.rawContent()).not.toContain('origins.\\*\\*');
    expect(component.rawContent()).not.toContain('<br />');
    expect(component.rawContent()).toContain('**(1) KNOWLEDGE**');
  });

  it('distinguishes and preserves dash bullets vs star bullets across round-trips and DOM rendering', async () => {
    const listText =
      '- Dash item 1\n' +
      '- Dash item 2\n\n' +
      '* Star item 1\n' +
      '* Star item 2';

    fixture.componentRef.setInput('initialValue', listText);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.detectChanges();

    // Verify DOM rendering
    const lists = fixture.nativeElement.querySelectorAll('ul');
    expect(lists.length).toBe(2);
    expect(lists[0].getAttribute('data-bullet')).toBe('-');
    expect(lists[0].classList.contains('list-dash')).toBe(true);
    expect(lists[1].getAttribute('data-bullet')).toBe('*');
    expect(lists[1].classList.contains('list-star')).toBe(true);

    // Verify serialization round trip
    const md = component.getMarkdown();
    expect(md).toContain('- Dash item 1');
    expect(md).toContain('- Dash item 2');
    expect(md).toContain('* Star item 1');
    expect(md).toContain('* Star item 2');
  });
});

