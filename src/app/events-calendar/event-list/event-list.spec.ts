import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventListComponent } from './event-list';
import { RoutingService } from '../../routing.service';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { FIREBASE_APP, Views, AppPathPatterns } from '../../app.config';
import {
  initEvent,
  IlcEvent,
} from '../../../../functions/src/data-model/events';
import { initSchool } from '../../../../functions/src/data-model/schools';
import { initInstructor } from '../../../../functions/src/data-model/members';

let snapshotCallback:
  | ((snap: { docs: Array<{ id: string; data: () => unknown }> }) => void)
  | null = null;

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn().mockReturnValue({}),
  query: vi.fn().mockReturnValue({}),
  where: vi.fn(),
  onSnapshot: vi.fn().mockImplementation((_q, cb) => {
    snapshotCallback = cb;
    return () => {};
  }),
}));

describe('EventListComponent', () => {
  let component: EventListComponent;
  let fixture: ComponentFixture<EventListComponent>;
  let mockRoutingService: RoutingService<AppPathPatterns>;
  let mockDataManagerService: Partial<DataManagerService>;
  let mockFirebaseState: ReturnType<typeof createFirebaseStateServiceMock>;

  let schoolIdSignal: WritableSignal<string>;
  let instructorIdSignal: WritableSignal<string>;
  let qSignal: WritableSignal<string>;
  let fromDateSignal: WritableSignal<string>;

  beforeEach(async () => {
    snapshotCallback = null;
    schoolIdSignal = signal('');
    instructorIdSignal = signal('');
    qSignal = signal('');
    fromDateSignal = signal('');

    mockFirebaseState = createFirebaseStateServiceMock();

    mockRoutingService = {
      matchedPatternId: signal(Views.EventsCalendar),
      hrefForView: vi.fn().mockImplementation((view: string) => `/${view}`),
      hrefWithParams: vi.fn().mockImplementation((path: string) => path),
      signals: {
        [Views.EventsCalendar]: {
          urlParams: {
            schoolId: schoolIdSignal,
            instructorId: instructorIdSignal,
            q: qSignal,
            fromDate: fromDateSignal,
          },
        },
      },
    } as unknown as RoutingService<AppPathPatterns>;

    const mockSchool = {
      ...initSchool(),
      schoolId: 'SCH-1',
      schoolName: 'New York School',
    };

    const mockInstructor = {
      ...initInstructor(),
      instructorId: 'INST-1',
      name: 'Master Sam Chin',
    };

    mockDataManagerService = {
      schools: {
        get: vi
          .fn()
          .mockImplementation((id: string) =>
            id === 'SCH-1' ? mockSchool : undefined,
          ),
      } as any,
      instructors: {
        get: vi
          .fn()
          .mockImplementation((id: string) =>
            id === 'INST-1' ? mockInstructor : undefined,
          ),
      } as any,
    };

    await TestBed.configureTestingModule({
      imports: [EventListComponent],
      providers: [
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FIREBASE_APP, useValue: {} },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should not show filter banner when no filter is active', () => {
    const banner = fixture.nativeElement.querySelector('.filter-banner');
    expect(banner).toBeNull();
  });

  it('should show filter banner and clear filter when schoolId is active', async () => {
    schoolIdSignal.set('SCH-1');
    fixture.detectChanges();
    await fixture.whenStable();

    const banner = fixture.nativeElement.querySelector('.filter-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('New York School [SCH-1]');

    const clearButton = banner.querySelector(
      'button.subtle-button',
    ) as HTMLButtonElement;
    expect(clearButton).toBeTruthy();
    expect(clearButton.textContent).toContain('Clear filter');

    // Click clear filter
    clearButton.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(schoolIdSignal()).toBe('');
    expect(instructorIdSignal()).toBe('');

    const bannerAfter = fixture.nativeElement.querySelector('.filter-banner');
    expect(bannerAfter).toBeNull();
  });

  it('should show filter banner and clear filter when instructorId is active', async () => {
    instructorIdSignal.set('INST-1');
    fixture.detectChanges();
    await fixture.whenStable();

    const banner = fixture.nativeElement.querySelector('.filter-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Master Sam Chin [INST-1]');

    component.clearFilter();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(instructorIdSignal()).toBe('');
    expect(schoolIdSignal()).toBe('');

    const bannerAfter = fixture.nativeElement.querySelector('.filter-banner');
    expect(bannerAfter).toBeNull();
  });
});
