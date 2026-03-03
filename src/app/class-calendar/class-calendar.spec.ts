import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ClassCalendarComponent } from './class-calendar';
import { ClassCalendarService } from '../class-calendar.service';
import { FindInstructorsService } from '../find-instructors.service';
import { SearchableSet } from '../searchable-set';
import { InstructorPublicData } from '../../../functions/src/data-model';

describe('ClassCalendarComponent', () => {
  let component: ClassCalendarComponent;
  let fixture: ComponentFixture<ClassCalendarComponent>;
  let calendarServiceMock: Partial<ClassCalendarService>;
  let findInstructorsServiceMock: Partial<FindInstructorsService>;

  beforeEach(async () => {
    calendarServiceMock = {
      getForthcomingEvents: () => Promise.resolve([]),
      getPreviousEvents: () => Promise.resolve([]),
    };

    findInstructorsServiceMock = {
      instructors: new SearchableSet<'instructorId', InstructorPublicData>(
        ['name', 'instructorId'],
        'instructorId',
      ),
    };

    await TestBed.configureTestingModule({
      imports: [ClassCalendarComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ClassCalendarService, useValue: calendarServiceMock },
        { provide: FindInstructorsService, useValue: findInstructorsServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassCalendarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('instructorId', 'test-instructor-id');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
