import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP } from '../app.config';
import { ManageEventsComponent } from './manage-events';

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
  let mockRoutingService: RoutingService<any>;

  beforeEach(async () => {
    mockRoutingService = {
      matchedPatternId: signal('manageEvents'),
      signals: {
        manageEvents: {
          urlParams: {
            q: signal(''),
            status: signal(''),
            sortBy: signal(''),
            sortDir: signal(''),
          },
        },
      },
    } as never as RoutingService<any>;

    await TestBed.configureTestingModule({
      imports: [ManageEventsComponent],
      providers: [
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FIREBASE_APP, useValue: {} },
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
