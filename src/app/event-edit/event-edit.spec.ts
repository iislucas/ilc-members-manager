import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP } from '../app.config';
import { EventEditComponent } from './event-edit';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';

// Mock firebase/firestore
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ empty: true }),
}));

describe('EventEditComponent', () => {
  let component: EventEditComponent;
  let fixture: ComponentFixture<EventEditComponent>;
  let mockRoutingService: RoutingService<any>;

  beforeEach(async () => {
    mockRoutingService = {
      navigateToParts: vi.fn(),
    } as never as RoutingService<any>;

    await TestBed.configureTestingModule({
      imports: [EventEditComponent],
      providers: [
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FIREBASE_APP, useValue: {} }, // Mock app object
        { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(EventEditComponent);
    component = fixture.componentInstance;
    
    // Set required input
    fixture.componentRef.setInput('eventId', 'test-doc-id');
    
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
