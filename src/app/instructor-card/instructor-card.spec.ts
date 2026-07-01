import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { InstructorCardComponent } from './instructor-card';
import { InstructorPublicData, initInstructor } from '../../../functions/src/data-model';

describe('InstructorCardComponent', () => {
  let fixture: ComponentFixture<InstructorCardComponent>;
  let component: InstructorCardComponent;

  function setInstructor(overrides: Partial<InstructorPublicData>) {
    fixture.componentRef.setInput('instructor', {
      ...initInstructor(),
      instructorId: 'I-101',
      name: 'Test Instructor',
      ...overrides,
    });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InstructorCardComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(InstructorCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    setInstructor({});
    expect(component).toBeTruthy();
  });

  it('builds the profile href from the instructor id', () => {
    setInstructor({});
    expect(component.profileHref()).toBe('/instructors/I-101');
  });
});
