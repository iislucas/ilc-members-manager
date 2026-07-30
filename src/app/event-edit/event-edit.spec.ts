import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, provideZonelessChangeDetection } from '@angular/core';
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
      instructors: new SearchableSet(['instructorId', 'name', 'memberId'], 'instructorId', []),
      schools: new SearchableSet(['schoolId'], 'schoolId', []),
    } as unknown as DataManagerService;

    await TestBed.configureTestingModule({
      imports: [EventEditComponent],
      providers: [
        provideZonelessChangeDetection(),
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
      contacts: [],
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

  it('should clear a manager row whose text no longer names an instructor', () => {
    const mockInstructor = {
      docId: 'instructor-member-doc-id',
      instructorId: 'I-101',
      name: 'Instructor Name',
    };
    (mockDataManagerService.instructors as any).setEntries([mockInstructor]);
    component.eventFormModel.set({
      ...component.eventFormModel(),
      managerDocIds: ['instructor-member-doc-id'],
    });

    // The user clears the box and starts typing a name. Nothing resolves yet,
    // so the row must no longer claim the previous manager — otherwise the
    // edit is silently discarded and the Save button never enables.
    component.updateManagerDocId(0, 'Someone El');

    expect(component.eventFormModel().managerDocIds[0]).toBe('');
  });

  it('should drop the contact listing when a manager row is cleared', () => {
    component.eventFormModel.set({
      ...component.eventFormModel(),
      managerDocIds: ['manager-doc-id'],
    });
    component.setContactListed('manager-doc-id', true);

    component.updateManagerDocId(0, 'Someone El');

    expect(component.eventFormModel().managerDocIds[0]).toBe('');
    expect(component.eventFormModel().contacts).toEqual([]);
  });

  it('resolves a manager row for a non-admin (empty members cache)', async () => {
    // Only admins load the full `members` collection; on /my-events/{id}/edit
    // the viewer is usually an ordinary instructor with an empty members cache,
    // so manager rows have to resolve through the public `instructors` set.
    const mockInstructor = {
      docId: 'manager-member-doc-id',
      instructorId: '197',
      memberId: 'MEM-197',
      name: 'Manager Name',
    };
    (mockDataManagerService.instructors as any).setEntries([mockInstructor]);
    (mockDataManagerService.members as any).setEntries([]);

    (mockDataManagerService.getEventById as any).mockResolvedValue({
      docId: 'test-doc-id',
      title: 'T', start: '2026-04-13', end: '2026-04-13',
      description: 'D', location: 'L',
      status: EventStatus.Proposed,
      heroImageUrl: '',
      ownerDocId: 'owner-id',
      managerDocIds: ['manager-member-doc-id'],
    } as IlcEvent);

    await component.loadEvent();
    fixture.detectChanges();
    await fixture.whenStable();

    const input: HTMLInputElement = fixture.nativeElement.querySelector(
      'input[placeholder="Search for a manager"]',
    );
    expect(input.value).toBe('197');
    expect(fixture.nativeElement.textContent).toContain('Manager Name');
  });

  it('should list and unlist a manager as a public contact', () => {
    (mockDataManagerService.members as any).setEntries([{
      docId: 'manager-doc-id',
      memberId: 'MEM-200',
      instructorId: 'I-200',
      name: 'Manager Name',
    }]);
    component.eventFormModel.set({
      ...component.eventFormModel(),
      managerDocIds: ['manager-doc-id'],
    });

    component.setContactListed('manager-doc-id', true);

    expect(component.isListedContact('manager-doc-id')).toBe(true);
    expect(component.contactFor('manager-doc-id')).toMatchObject({
      memberDocId: 'manager-doc-id',
      name: 'Manager Name',
      memberId: 'MEM-200',
      instructorId: 'I-200',
    });

    component.setContactListed('manager-doc-id', false);

    expect(component.isListedContact('manager-doc-id')).toBe(false);
    expect(component.eventFormModel().contacts).toEqual([]);
  });

  it('should drop a removed manager from the contacts', () => {
    component.eventFormModel.set({
      ...component.eventFormModel(),
      managerDocIds: ['manager-doc-id'],
    });
    component.setContactListed('manager-doc-id', true);

    component.removeManagerDocId(0);

    expect(component.eventFormModel().managerDocIds).toEqual([]);
    expect(component.eventFormModel().contacts).toEqual([]);
  });

  it('should hand the creator listing to a newly assigned creator', () => {
    const mockInstructor = {
      docId: 'instructor-member-doc-id',
      instructorId: 'I-101',
      memberId: 'MEM-101',
      name: 'Instructor Name',
    };
    (mockDataManagerService.instructors as any).setEntries([mockInstructor]);
    component.eventFormModel.set({
      ...component.eventFormModel(),
      ownerDocId: 'old-owner-doc-id',
      ownerName: 'Old Owner',
    });
    component.setContactListed('old-owner-doc-id', true);

    component.updateOwnerInstructor('I-101');

    expect(component.eventFormModel().contacts).toEqual([{
      memberDocId: 'instructor-member-doc-id',
      name: 'Instructor Name',
      memberId: 'MEM-101',
      instructorId: 'I-101',
      contactEmail: '',
      contactUrl: '',
    }]);
  });

  it('should save only creator/manager contacts, with the creator details', async () => {
    component.event.set({
      docId: 'test-doc-id',
      title: 'Title',
      ownerDocId: 'owner-id',
    } as IlcEvent);
    component.eventFormModel.set({
      ...component.eventFormModel(),
      title: 'Title',
      start: '2026-04-13',
      end: '2026-04-13',
      ownerDocId: 'owner-id',
      ownerName: 'Owner Name',
      ownerMemberId: 'MEM-1',
      ownerInstructorId: 'I-1',
      ownerContactEmail: 'owner@example.com',
      ownerContactUrl: 'https://example.com',
      managerDocIds: ['manager-doc-id'],
      contacts: [
        { memberDocId: 'owner-id', name: 'stale', memberId: '', instructorId: '', contactEmail: '', contactUrl: '' },
        { memberDocId: 'ex-manager-doc-id', name: 'Gone', memberId: '', instructorId: '', contactEmail: '', contactUrl: '' },
      ],
    });

    await component.saveEvent({ preventDefault: vi.fn() } as unknown as Event);

    expect(component.errorMessage()).toBe(null);
    const saved = (updateDoc as any).mock.calls.at(-1)[1];
    // Round-tripped through JSON: the form model tags its objects with symbol
    // properties that a direct deep-equality would trip over.
    expect(JSON.parse(JSON.stringify(saved.contacts))).toEqual([{
      memberDocId: 'owner-id',
      name: 'Owner Name',
      memberId: 'MEM-1',
      instructorId: 'I-1',
      contactEmail: 'owner@example.com',
      contactUrl: 'https://example.com',
    }]);
  });
});
