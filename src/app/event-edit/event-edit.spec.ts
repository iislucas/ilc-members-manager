import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { RoutingService } from '../routing.service';
import { FIREBASE_APP, AppPathPatterns, Views } from '../app.config';
import { EventEditComponent } from './event-edit';
import { FirebaseStateService, createFirebaseStateServiceMock } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { IlcEvent, EventStatus, EventSourceKind } from '../../../functions/src/data-model';
import { updateDoc } from 'firebase/firestore';
import { SearchableSet } from '../searchable-set';

// Mock firebase/firestore
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  doc: vi.fn().mockReturnValue({ id: 'test-doc-id' }),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ empty: true }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
}));

describe('EventEditComponent', () => {
  let component: EventEditComponent;
  let fixture: ComponentFixture<EventEditComponent>;
  let mockRoutingService: RoutingService<AppPathPatterns>;
  let mockDataManagerService: DataManagerService;

  beforeEach(async () => {
    mockRoutingService = {
      navigateToParts: vi.fn(),
      matchedPatternId: signal(Views.ManageEventEdit),
      hrefWithParams: vi.fn().mockReturnValue('#'),
    } as unknown as RoutingService<AppPathPatterns>;

    mockDataManagerService = {
      getEventById: vi.fn().mockResolvedValue(undefined),
      getMemberByMemberId: vi.fn().mockReturnValue(undefined),
      members: new SearchableSet(['name'], 'docId', []),
      instructors: new SearchableSet(['instructorId'], 'instructorId', []),
    } as unknown as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [EventEditComponent],
      providers: [
        { provide: RoutingService, useValue: mockRoutingService },
        { provide: FIREBASE_APP, useValue: {} }, // Mock app object
        { provide: FirebaseStateService, useValue: createFirebaseStateServiceMock() },
        { provide: DataManagerService, useValue: mockDataManagerService },
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

  it('should update local event and reset isDirty on save', async () => {
    const mockEvent: IlcEvent = {
      docId: 'test-doc-id',
      title: 'Original Title',
      start: '2026-04-13',
      end: '2026-04-13',
      description: 'Original Description',
      location: 'Original Location',
      status: EventStatus.Proposed,
      heroImageUrl: '',
      ownerDocId: 'owner-id',
    } as IlcEvent;

    component.event.set(mockEvent);
    component.eventFormModel.set({
      title: 'New Title',
      start: '2026-04-14',
      end: '2026-04-14',
      description: 'New Description',
      location: 'New Location',
      status: EventStatus.Listed,
      heroImageUrl: 'http://example.com/image.jpg',
      ownerDocId: 'owner-id',
      ownerName: '',
      ownerMemberId: '',
      ownerInstructorId: '',
      ownerContactEmail: '',
      ownerContactUrl: '',
      managerDocIds: [],
      leadingInstructorId: '',
      schoolId: '',
      schoolDocId: '',
      documents: [],
    });

    // Trigger computed signals
    fixture.detectChanges();

    expect(component.isDirty()).toBe(true);

    const event = { preventDefault: vi.fn() } as unknown as Event;
    await component.saveEvent(event);

    expect(component.successMessage()).toBe('Event saved successfully.');
    expect(component.isDirty()).toBe(false);
    expect(component.event()?.title).toBe('New Title');
    expect(component.event()?.status).toBe(EventStatus.Listed);
    expect(component.event()?.heroImageUrl).toBe('http://example.com/image.jpg');
    
    // Verify updateDoc was called with heroImageUrl and kind
    expect(updateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        heroImageUrl: 'http://example.com/image.jpg',
        kind: EventSourceKind.FirebaseSourced
      })
    );
  });

  it('should preserve heroImageUrl when loading event', async () => {
    const mockEvent: IlcEvent = {
      docId: 'test-doc-id',
      title: 'Test Event Title',
      start: '2026-04-13',
      end: '2026-04-13',
      description: 'Description',
      location: 'Location',
      status: EventStatus.Proposed,
      heroImageUrl: 'http://example.com/hero.jpg',
      ownerDocId: 'owner-id',
    } as IlcEvent;

    (mockDataManagerService.getEventById as any).mockResolvedValue(mockEvent);
    
    await component.loadEvent();
    
    expect(component.eventFormModel().heroImageUrl).toBe('http://example.com/hero.jpg');
    expect(component.event()?.heroImageUrl).toBe('http://example.com/hero.jpg');
  });

  it('should emit titleLoaded when event is loaded', async () => {
    const mockEvent: IlcEvent = {
      docId: 'test-doc-id',
      title: 'Test Event Title',
      start: '2026-04-13',
      end: '2026-04-13',
      description: 'Description',
      location: 'Location',
      status: EventStatus.Proposed,
      heroImageUrl: '',
      ownerDocId: 'owner-id',
    } as IlcEvent;

    (mockDataManagerService.getEventById as any).mockResolvedValue(mockEvent);
    
    const titleLoadedSpy = vi.spyOn(component.titleLoaded, 'emit');
    
    await component.loadEvent();
    
    expect(titleLoadedSpy).toHaveBeenCalledWith('Test Event Title');
  });

  it('should assign the owner via instructor lookup and cache identity', () => {
    const mockInstructor = {
      docId: 'instructor-member-doc-id',
      instructorId: 'I-101',
      memberId: 'MEM-101',
      name: 'Instructor Name',
    };
    (mockDataManagerService.instructors as any).setEntries([mockInstructor]);

    component.updateOwnerInstructor('I-101');

    const m = component.eventFormModel();
    expect(m.ownerDocId).toBe('instructor-member-doc-id');
    expect(m.ownerName).toBe('Instructor Name');
    expect(m.ownerMemberId).toBe('MEM-101');
    expect(m.ownerInstructorId).toBe('I-101');
  });

  it('should assign the owner via member lookup for a non-instructor', () => {
    const mockMember = {
      docId: 'member-doc-id',
      memberId: 'MEM-500',
      instructorId: '',
      name: 'Non Instructor',
    };
    (mockDataManagerService.getMemberByMemberId as any).mockReturnValue(mockMember);

    component.updateOwnerMember('(MEM-500) Non Instructor');

    const m = component.eventFormModel();
    expect(m.ownerDocId).toBe('member-doc-id');
    expect(m.ownerName).toBe('Non Instructor');
    expect(m.ownerMemberId).toBe('MEM-500');
    expect(m.ownerInstructorId).toBe('');
  });

  it('should update managerDocIds via instructor lookup', () => {
    const mockInstructor = {
      docId: 'instructor-member-doc-id',
      instructorId: 'I-101',
      name: 'Instructor Name',
    };
    (mockDataManagerService.instructors as any).setEntries([mockInstructor]);
    component.eventFormModel.set({ ...component.eventFormModel(), managerDocIds: [''] });

    component.updateManagerDocId(0, 'I-101');

    expect(component.eventFormModel().managerDocIds[0]).toBe('instructor-member-doc-id');
  });
});
