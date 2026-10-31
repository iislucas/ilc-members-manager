import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { InstructorCardComponent } from './instructor-card';
import { ApplicationLevel, StudentLevel } from '../../../functions/src/data-model/curriculum';
import { InstructorPublicData, initInstructor } from '../../../functions/src/data-model/members';

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

  it('renders student and application level chips for non-grandmaster instructors', () => {
    setInstructor({
      tags: ['Senior Instructor'],
      studentLevel: StudentLevel.Level11,
      applicationLevel: ApplicationLevel.Level6,
    });

    const el: HTMLElement = fixture.nativeElement;
    const tagChips = Array.from(el.querySelectorAll('.tag-chip')).map((n) =>
      n.textContent?.trim(),
    );
    const levelChips = Array.from(el.querySelectorAll('.level-chip')).map((n) =>
      n.textContent?.trim(),
    );

    expect(tagChips).toEqual(['Senior Instructor']);
    expect(levelChips).toEqual(['Student 11', 'Application 6']);
  });

  it('hides student and application level chips when instructor has the Grandmaster tag', () => {
    setInstructor({
      tags: ['Grandmaster'],
      studentLevel: StudentLevel.Level11,
      applicationLevel: ApplicationLevel.Level6,
    });

    const el: HTMLElement = fixture.nativeElement;
    const tagChips = Array.from(el.querySelectorAll('.tag-chip')).map((n) =>
      n.textContent?.trim(),
    );
    const levelChips = Array.from(el.querySelectorAll('.level-chip'));

    expect(tagChips).toEqual(['Grandmaster']);
    expect(levelChips.length).toBe(0);
  });

  it('matches the grandmaster tag case-insensitively', () => {
    setInstructor({
      tags: ['  grandmaster  '],
      studentLevel: StudentLevel.Level11,
      applicationLevel: ApplicationLevel.Level6,
    });

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.level-chip').length).toBe(0);
    expect(el.querySelector('.tag-chip')?.textContent?.trim()).toBe('grandmaster');
  });
});
