import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ClassCalendarComponent } from './class-calendar';
import { ClassCalendarService } from '../class-calendar.service';

describe('ClassCalendarComponent', () => {
  let component: ClassCalendarComponent;
  let fixture: ComponentFixture<ClassCalendarComponent>;
  let calendarServiceMock: Partial<ClassCalendarService>;

  beforeEach(async () => {
    calendarServiceMock = {
      getForthcomingEvents: () => Promise.resolve([]),
      getPreviousEvents: () => Promise.resolve([]),
    };

    await TestBed.configureTestingModule({
      imports: [ClassCalendarComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ClassCalendarService, useValue: calendarServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassCalendarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('calendarId', 'test-calendar-id');
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
