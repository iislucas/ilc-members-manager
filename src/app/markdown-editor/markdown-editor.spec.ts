import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MarkdownEditor } from './markdown-editor';
import { editorViewCtx } from '@milkdown/core';

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
});
