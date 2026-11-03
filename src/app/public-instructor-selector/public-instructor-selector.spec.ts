import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicInstructorSelectorComponent } from './public-instructor-selector';
import { DataManagerService } from '../data-manager.service';
import { SearchableSet } from '../searchable-set';
import { initInstructor, InstructorPublicData } from '../../../functions/src/data-model/members';

function makeInstructor(overrides: Partial<InstructorPublicData>): InstructorPublicData {
  return { ...initInstructor(), ...overrides };
}

describe('PublicInstructorSelectorComponent', () => {
  let component: PublicInstructorSelectorComponent;
  let fixture: ComponentFixture<PublicInstructorSelectorComponent>;

  const alice = makeInstructor({ docId: 'm-alice', name: 'Alice Teacher', instructorId: '98', memberId: 'AT3' });

  beforeEach(async () => {
    const instructors = new SearchableSet<'instructorId', InstructorPublicData>(
      ['name', 'instructorId', 'memberId'], 'instructorId', [alice],
    );
    const mockDataManagerService = { instructors } as never as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [PublicInstructorSelectorComponent],
      providers: [{ provide: DataManagerService, useValue: mockDataManagerService }],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicInstructorSelectorComponent);
    component = fixture.componentInstance;
  });

  it('shows the empty label when nothing is selected', () => {
    fixture.componentRef.setInput('value', '');
    fixture.componentRef.setInput('emptyLabel', 'Nobody yet');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Nobody yet');
  });

  it('shows "name [instructorId]" for a resolved instructor', () => {
    fixture.componentRef.setInput('value', '98');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Alice Teacher');
    expect(text).toContain('98');
  });

  it('only allows Set once the draft is a numeric instructorId (rejecting Member IDs and names)', () => {
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
    component.startEdit();
    component.draft.set('nope');
    expect(component.canSet()).toBe(false);
    // Member ID namespace (e.g. AT3) must not be accepted as an Instructor ID
    component.draft.set('AT3');
    expect(component.canSet()).toBe(false);
    component.draft.set('98');
    expect(component.canSet()).toBe(true);
  });

  it('emits valueChange only on Set, and closes the editor', () => {
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
    const emitted: string[] = [];
    component.valueChange.subscribe((v) => emitted.push(v));

    component.startEdit();
    component.draft.set('98');
    component.setValue();
    expect(emitted).toEqual(['98']);
    expect(component.isEditing()).toBe(false);
  });

  it('does not emit on Cancel', () => {
    fixture.componentRef.setInput('value', '');
    fixture.detectChanges();
    const emitted: string[] = [];
    component.valueChange.subscribe((v) => emitted.push(v));

    component.startEdit();
    component.draft.set('98');
    component.cancel();
    expect(emitted).toEqual([]);
    expect(component.isEditing()).toBe(false);
  });

  it('supports clearing the selected instructor when allowClear is true', () => {
    fixture.componentRef.setInput('value', '98');
    fixture.componentRef.setInput('allowClear', true);
    fixture.detectChanges();
    const emitted: string[] = [];
    component.valueChange.subscribe((v) => emitted.push(v));

    component.clearValue();
    expect(emitted).toEqual(['']);
    expect(component.isEditing()).toBe(false);
  });

  it('prevents editing and hides edit buttons when disabled is true', () => {
    fixture.componentRef.setInput('value', '98');
    fixture.componentRef.setInput('disabled', true);
    fixture.componentRef.setInput('allowClear', true);
    fixture.detectChanges();

    component.startEdit();
    expect(component.isEditing()).toBe(false);
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('flags non-numeric committed values as invalid format', () => {
    fixture.componentRef.setInput('value', 'SAM CHIN');
    fixture.detectChanges();
    expect(component.hasInvalidFormat()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Invalid instructor ID');
  });
});
