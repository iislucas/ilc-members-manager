import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { AutocompleteComponent } from './autocomplete';

describe('AutocompleteComponent', () => {
  let component: AutocompleteComponent<any, any>;
  let fixture: ComponentFixture<AutocompleteComponent<any, any>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AutocompleteComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(AutocompleteComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('searchableSet', { search: () => [] });
    fixture.componentRef.setInput('displayFns', {
      toChipId: (x: any) => x.id,
      toName: (x: any) => x.name,
    });
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should fit menu to visible area, set maxWidth, and shift left when overflowing', async () => {
    const items = [
      { id: '1', name: 'Very Long Video Title That Exceeds The Screen Width And Should Wrap' },
    ];
    fixture.componentRef.setInput('searchableSet', {
      idField: 'id',
      search: () => items,
      uniqueEntries: () => items,
      entries: () => items,
    });
    component.showResults.set(true);
    await fixture.whenStable();

    const menuEl = fixture.nativeElement.querySelector('ul.results-list') as HTMLUListElement;
    expect(menuEl).toBeTruthy();

    // Mock document.documentElement.clientWidth to 800px
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);

    // Mock getBoundingClientRect on menuEl
    vi.spyOn(menuEl, 'getBoundingClientRect').mockReturnValue({
      left: 200,
      right: 1000,
      top: 50,
      bottom: 200,
      width: 800,
      height: 150,
      x: 200,
      y: 50,
      toJSON: () => {},
    });

    (component as any).fitMenuToViewport(menuEl);

    // maxRight = 800 - 16 = 784
    // overflowRight = 1000 - 784 = 216
    // minLeft = 16. maxShift = 200 - 16 = 184
    // shift = min(216, 184) = 184
    expect(menuEl.style.left).toBe('-184px');
    // currentLeft = 200 - 184 = 16
    // availableWidth = 784 - 16 = 768
    expect(menuEl.style.maxWidth).toBe('768px');
  });

  it('should account for clipping parent when calculating visible bounds', async () => {
    const items = [
      { id: '1', name: 'Video Title' },
    ];
    fixture.componentRef.setInput('searchableSet', {
      idField: 'id',
      search: () => items,
      uniqueEntries: () => items,
      entries: () => items,
    });
    component.showResults.set(true);
    await fixture.whenStable();

    const menuEl = fixture.nativeElement.querySelector('ul.results-list') as HTMLUListElement;
    expect(menuEl).toBeTruthy();

    // Create a mock parent element with overflowX: clip and known bounds
    const clippingParent = document.createElement('main');
    clippingParent.style.overflowX = 'clip';
    document.body.appendChild(clippingParent);
    clippingParent.appendChild(fixture.nativeElement);

    vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      if (el === clippingParent) {
        return { overflowX: 'clip' } as CSSStyleDeclaration;
      }
      return { overflowX: 'visible' } as CSSStyleDeclaration;
    });

    vi.spyOn(clippingParent, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 600,
      top: 0,
      bottom: 500,
      width: 500,
      height: 500,
      x: 100,
      y: 0,
      toJSON: () => {},
    });

    vi.spyOn(menuEl, 'getBoundingClientRect').mockReturnValue({
      left: 150,
      right: 700,
      top: 50,
      bottom: 200,
      width: 550,
      height: 150,
      x: 150,
      y: 50,
      toJSON: () => {},
    });

    (component as any).fitMenuToViewport(menuEl);

    // Parent right is 600. maxRight = 600 - 16 = 584
    // Parent left is 100. minLeft = 100 + 16 = 116
    // overflowRight = 700 - 584 = 116
    // maxShift = 150 - 116 = 34
    // shift = min(116, 34) = 34
    expect(menuEl.style.left).toBe('-34px');
    // currentLeft = 150 - 34 = 116
    // availableWidth = 584 - 116 = 468
    expect(menuEl.style.maxWidth).toBe('468px');

    document.body.removeChild(clippingParent);
  });

  it('should re-fit menu on window resize if results are shown', () => {
    const fitSpy = vi.spyOn(component as any, 'fitMenuToViewport');
    component.showResults.set(false);
    component.onWindowResize();
    expect(fitSpy).not.toHaveBeenCalled();

    component.showResults.set(true);
    // Menu might be undefined if not in DOM, but method shouldn't throw
    expect(() => component.onWindowResize()).not.toThrow();
  });
});
