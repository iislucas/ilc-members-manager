import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, AppPathPatterns, Views } from '../app.config';
import { ManageEventsComponent } from './manage-events';
import { DataManagerService } from '../data-manager.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { initEvent, EventStatus, IlcEvent } from '../../../functions/src/data-model/events';

// Mock firebase/firestore
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  onSnapshot: vi.fn().mockReturnValue(() => {}), // return unsubscribe function
  doc: vi.fn(),
  updateDoc: vi.fn(),
}));

describe('ManageEventsComponent', () => {
  let component: ManageEventsComponent;
  let fixture: ComponentFixture<ManageEventsComponent>;
  let mockRoutingService: RoutingService<AppPathPatterns>;
  let mockDataManagerService: DataManagerService;
  let mockFirebaseState: ReturnType<typeof createFirebaseStateServiceMock>;

  beforeEach(async () => {
    mockFirebaseState = createFirebaseStateServiceMock();
    mockFirebaseState.user.set({
      email: 'admin@test.com',
      isAdmin: true,
    } as any);

    mockRoutingService = {
      matchedPatternId: signal(Views.ManageEvents),
      hrefForView: vi.fn().mockImplementation((view: string) => `/${view}`),
      hrefWithParams: vi.fn().mockImplementation((path: string) => path),
      signals: {
        [Views.ManageEvents]: {
          urlParams: {
            q: signal(''),
            status: signal(''),
            sortBy: signal(''),
            sortDir: signal(''),
            searchMode: signal(''),
            searchField: signal(''),
            startDate: signal(''),
            endDate: signal(''),
          },
        },
      },
    } as unknown as RoutingService<AppPathPatterns>;

    mockDataManagerService = {
      getRecentEvents: vi.fn().mockResolvedValue([]),
      searchEvents: vi.fn().mockResolvedValue([]),
      getMemberByDocId: vi.fn().mockReturnValue(undefined),
      instructors: { get: vi.fn().mockReturnValue(undefined) },
    } as unknown as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [ManageEventsComponent],
      providers: [
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FIREBASE_APP, useValue: {} },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: FirebaseStateService, useValue: mockFirebaseState },
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ManageEventsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render a Create Event button linking to ProposeEvent', () => {
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('.create-event-btn');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Create Event');
    expect(btn.getAttribute('href')).toBe(`/${Views.ProposeEvent}`);
  });

  describe('formatTimestamp', () => {
    it('should return empty string for nullish values', () => {
      expect(component.formatTimestamp(null)).toBe('');
      expect(component.formatTimestamp(undefined)).toBe('');
      expect(component.formatTimestamp('')).toBe('');
    });

    it('should format an ISO date string', () => {
      const result = component.formatTimestamp('2026-09-06T21:33:00.000Z');
      expect(result).toContain('2026');
      expect(result).toContain('Sep');
    });

    it('should format a Date object', () => {
      const date = new Date(2026, 8, 6, 14, 30);
      const result = component.formatTimestamp(date);
      expect(result).toContain('2026');
      expect(result).toContain('Sep');
    });

    it('should format a Firestore Timestamp-like object with seconds', () => {
      const ts = { seconds: 1788739200, nanoseconds: 0 };
      const result = component.formatTimestamp(ts);
      expect(result).toContain('2026');
    });

    it('should format a Timestamp-like object with _seconds', () => {
      const ts = { _seconds: 1788739200, _nanoseconds: 0 };
      const result = component.formatTimestamp(ts);
      expect(result).toContain('2026');
    });

    it('should format a Firestore Timestamp-like object with toDate()', () => {
      const ts = { toDate: () => new Date(2026, 8, 6) };
      const result = component.formatTimestamp(ts);
      expect(result).toContain('2026');
      expect(result).toContain('Sep');
    });
  });

  it('should display formatted lastUpdated in event card', async () => {
    const eventWithTimestamp: IlcEvent = {
      ...initEvent(),
      docId: 'ev-ts',
      title: 'Timestamped Workshop',
      status: EventStatus.Listed,
      lastUpdated: '2026-09-06T15:00:00.000Z',
      updatedByEmail: 'editor@example.com',
    };
    vi.mocked(mockDataManagerService.searchEvents).mockResolvedValue([eventWithTimestamp]);
    vi.mocked(mockDataManagerService.getRecentEvents).mockResolvedValue([eventWithTimestamp]);
    await component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    const lastUpdatedSpan = fixture.nativeElement.querySelector('.last-updated');
    expect(lastUpdatedSpan).toBeTruthy();
    expect(lastUpdatedSpan.textContent).toContain('2026');
    expect(lastUpdatedSpan.textContent).toContain('by editor@example.com');
  });

  it('should display HQ Registration chip when user is admin and event has productId', async () => {
    const eventWithProduct: IlcEvent = {
      ...initEvent(),
      docId: 'ev-1',
      title: 'Workshop with Product',
      status: EventStatus.Listed,
      productId: 'prod-123',
    };
    vi.mocked(mockDataManagerService.searchEvents).mockResolvedValue([eventWithProduct]);
    vi.mocked(mockDataManagerService.getRecentEvents).mockResolvedValue([eventWithProduct]);
    await component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.hq-registration-chip');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain('HQ Registration');
  });

  it('should not display HQ Registration chip when event has no productId', async () => {
    const eventWithoutProduct: IlcEvent = {
      ...initEvent(),
      docId: 'ev-2',
      title: 'Free Workshop',
      status: EventStatus.Listed,
    };
    vi.mocked(mockDataManagerService.searchEvents).mockResolvedValue([eventWithoutProduct]);
    vi.mocked(mockDataManagerService.getRecentEvents).mockResolvedValue([eventWithoutProduct]);
    await component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.hq-registration-chip');
    expect(chip).toBeNull();
  });

  it('should not display HQ Registration chip when user is not admin', async () => {
    mockFirebaseState.user.set({
      email: 'user@test.com',
      isAdmin: false,
    } as any);
    const eventWithProduct: IlcEvent = {
      ...initEvent(),
      docId: 'ev-3',
      title: 'Workshop with Product',
      status: EventStatus.Listed,
      productId: 'prod-123',
    };
    vi.mocked(mockDataManagerService.searchEvents).mockResolvedValue([eventWithProduct]);
    vi.mocked(mockDataManagerService.getRecentEvents).mockResolvedValue([eventWithProduct]);
    await component.search();
    await fixture.whenStable();
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector('.hq-registration-chip');
    expect(chip).toBeNull();
  });
});
