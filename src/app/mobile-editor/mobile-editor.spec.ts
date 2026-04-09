import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MobileEditor } from './mobile-editor';

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
});
