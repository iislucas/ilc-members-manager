import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MobileEditor } from './mobile-editor';
import { editorViewCtx } from '@milkdown/core';

describe('MobileEditor', () => {
  let component: MobileEditor;
  let fixture: ComponentFixture<MobileEditor>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MobileEditor]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MobileEditor);
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
});
