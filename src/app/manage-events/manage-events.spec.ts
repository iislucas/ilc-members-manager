import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, AppPathPatterns, Views } from '../app.config';
import { ManageEventsComponent } from './manage-events';
import { DataManagerService } from '../data-manager.service';

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

  beforeEach(async () => {
    mockRoutingService = {
      matchedPatternId: signal(Views.ManageEvents),
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
    } as unknown as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [ManageEventsComponent],
      providers: [
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FIREBASE_APP, useValue: {} },
        { provide: DataManagerService, useValue: mockDataManagerService },
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
});
