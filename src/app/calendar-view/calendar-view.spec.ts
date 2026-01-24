import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { CalendarView } from './calendar-view';
import { CalendarService } from '../calendar.service';

describe('CalendarView', () => {
  let component: CalendarView;
  let fixture: ComponentFixture<CalendarView>;
  let calendarServiceMock: Partial<CalendarService>;

  beforeEach(async () => {
    calendarServiceMock = {
      getForthcomingClasses: () => Promise.resolve([]),
      getPreviousClasses: () => Promise.resolve([]),
    };

    await TestBed.configureTestingModule({
      imports: [CalendarView],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CalendarService, useValue: calendarServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CalendarView);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
