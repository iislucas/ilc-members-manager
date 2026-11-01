/* class-calendar.spec.ts
 *
 * Unit tests for ClassCalendarComponent and extractGoogleCalendarId.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { vi } from 'vitest';

import { ClassCalendarComponent } from './class-calendar';
import { ClassCalendarService, PREVIOUS_CLASSES_DAYS } from '../class-calendar.service';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { provideNavigationTreeStub } from '../navigation-tree.testing';
import {
  extractGoogleCalendarId,
  GoogleCalendarEventItem,
} from '../../../functions/src/calendar.types';

describe('extractGoogleCalendarId', () => {
  it('returns empty string for empty or whitespace input', () => {
    expect(extractGoogleCalendarId('')).toBe('');
    expect(extractGoogleCalendarId('   ')).toBe('');
  });

  it('preserves a raw Google Calendar ID and trims whitespace', () => {
    expect(extractGoogleCalendarId('  abc123@group.calendar.google.com  ')).toBe(
      'abc123@group.calendar.google.com',
    );
    expect(extractGoogleCalendarId('instructor@gmail.com')).toBe(
      'instructor@gmail.com',
    );
  });

  it('extracts calendar ID from a Google Calendar embed URL (?src=...)', () => {
    expect(
      extractGoogleCalendarId(
        'https://calendar.google.com/calendar/embed?src=abc123%40group.calendar.google.com&ctz=America%2FNew_York',
      ),
    ).toBe('abc123@group.calendar.google.com');
  });

  it('extracts calendar ID from a scheme-less Google Calendar URL', () => {
    expect(
      extractGoogleCalendarId(
        'calendar.google.com/calendar/embed?src=school%40group.calendar.google.com',
      ),
    ).toBe('school@group.calendar.google.com');
  });

  it('extracts and base64-decodes calendar ID from a shareable URL (?cid=...)', () => {
    // btoa('abc123@group.calendar.google.com') === 'YWJjMTIzQGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20='
    expect(
      extractGoogleCalendarId(
        'https://calendar.google.com/calendar/u/0?cid=YWJjMTIzQGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20',
      ),
    ).toBe('abc123@group.calendar.google.com');

    // Plain URL-encoded cid containing '@'
    expect(
      extractGoogleCalendarId(
        'https://calendar.google.com/calendar/r?cid=abc123%40group.calendar.google.com',
      ),
    ).toBe('abc123@group.calendar.google.com');
  });

  it('extracts calendar ID from a public iCal URL (/calendar/ical/...)', () => {
    expect(
      extractGoogleCalendarId(
        'https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/public/basic.ics',
      ),
    ).toBe('abc123@group.calendar.google.com');
  });

  it('extracts calendar ID from a pasted <iframe> embed snippet', () => {
    expect(
      extractGoogleCalendarId(
        '<iframe src="https://calendar.google.com/calendar/embed?src=abc123%40group.calendar.google.com&amp;ctz=UTC" style="border: 0" width="800" height="600"></iframe>',
      ),
    ).toBe('abc123@group.calendar.google.com');
  });
});

describe('ClassCalendarComponent', () => {
  let component: ClassCalendarComponent;
  let fixture: ComponentFixture<ClassCalendarComponent>;
  let getForthcomingEventsMock: ReturnType<
    typeof vi.fn<ClassCalendarService['getForthcomingEvents']>
  >;
  let getPreviousEventsMock: ReturnType<
    typeof vi.fn<ClassCalendarService['getPreviousEvents']>
  >;

  beforeEach(async () => {
    getForthcomingEventsMock = vi
      .fn<ClassCalendarService['getForthcomingEvents']>()
      .mockResolvedValue([]);
    getPreviousEventsMock = vi
      .fn<ClassCalendarService['getPreviousEvents']>()
      .mockResolvedValue([]);

    const calendarServiceMock: Partial<ClassCalendarService> = {
      getForthcomingEvents: getForthcomingEventsMock,
      getPreviousEvents: getPreviousEventsMock,
    };

    await TestBed.configureTestingModule({
      imports: [ClassCalendarComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNavigationTreeStub(),
        { provide: ClassCalendarService, useValue: calendarServiceMock },
        {
          provide: ROUTING_CONFIG,
          useValue: { validPathPatterns: initPathPatterns },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClassCalendarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('calendarId', 'test-calendar-id');
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows "No previous classes in the last N days" sub-header when previous classes are empty', () => {
    const sections = fixture.nativeElement.querySelectorAll('.class-section');
    expect(sections.length).toBe(2);

    const previousSection = sections[1] as HTMLElement;
    expect(previousSection.querySelector('h2')?.textContent).toContain('Previous Classes');

    const subheader = previousSection.querySelector('.section-subheader');
    expect(subheader).toBeTruthy();
    expect(subheader?.textContent?.trim()).toBe(
      `No previous classes in the last ${PREVIOUS_CLASSES_DAYS} days`,
    );
    expect(previousSection.querySelector('ul')).toBeNull();
  });

  it('renders previous class items and hides the empty sub-header when previous classes exist', async () => {
    const pastEvents: GoogleCalendarEventItem[] = [
      {
        id: 'prev-1',
        summary: 'Spinning Hands Practice',
        start: { dateTime: '2026-10-28T18:00:00Z' },
        htmlLink: 'https://calendar.google.com/event?eid=prev-1',
      },
    ];
    getPreviousEventsMock.mockResolvedValue(pastEvents);

    component.refreshCalendar(component.selectedDate());
    await fixture.whenStable();
    fixture.detectChanges();

    const previousSection = fixture.nativeElement.querySelectorAll(
      '.class-section',
    )[1] as HTMLElement;
    expect(previousSection.querySelector('.section-subheader')).toBeNull();
    const listItems = previousSection.querySelectorAll('ul li');
    expect(listItems.length).toBe(1);
    expect(listItems[0].textContent).toContain('Spinning Hands Practice');
  });

  it('shows a clean message instead of spinning forever when calendarId is empty and not loading', async () => {
    fixture.componentRef.setInput('calendarId', '');
    fixture.componentRef.setInput('calendarLoading', false);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'No class calendar has been configured.',
    );
    expect(fixture.nativeElement.querySelector('app-spinner')).toBeNull();
  });
});
