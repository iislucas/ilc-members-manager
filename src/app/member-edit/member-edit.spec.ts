import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MemberEditComponent } from './member-edit';
import { DataManagerService, DataServiceState } from '../data-manager.service';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../firebase-state.service';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  initMember,
  Member,
  MembershipType,
} from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';

describe('MemberEditComponent', () => {
  let component: MemberEditComponent;
  let fixture: ComponentFixture<MemberEditComponent>;
  let dataManagerServiceMock: jasmine.SpyObj<DataManagerService>;
  let firebaseStateServiceMock: any;

  const mockMember: Member = {
    ...initMember(),
    id: 'test-id',
    name: 'Test Member',
    emails: ['test@example.com'],
    memberId: 'US001',
    country: 'United States',
    membershipType: MembershipType.Annual,
  };

  beforeEach(async () => {
    dataManagerServiceMock = jasmine.createSpyObj(
      'DataManagerService',
      [
        'updateMember',
        'addMember',
        'createNextMemberId',
        'createNextInstructorId',
      ],
      {
        loadingState: signal(DataServiceState.Loaded),
        members: new SearchableSet<'memberId', Member>(
          ['name'],
          'memberId',
          [],
        ),
        instructors: new SearchableSet<'instructorId', any>(
          ['name'],
          'instructorId',
          [],
        ),
        schools: new SearchableSet<'schoolId', any>(
          ['schoolName'],
          'schoolId',
          [],
        ),
        countries: new SearchableSet<'id', any>(['name'], 'id', []),
        counters: signal(null),
      },
    );

    dataManagerServiceMock.countries.setEntries([
      { id: 'US', name: 'United States' },
    ]);

    firebaseStateServiceMock = createFirebaseStateServiceMock();
    firebaseStateServiceMock.user.set({
      isAdmin: true,
      member: mockMember,
      schoolsManaged: [],
      firebaseUser: { email: 'admin@example.com' } as any,
    });

    await TestBed.configureTestingModule({
      imports: [MemberEditComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: dataManagerServiceMock },
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MemberEditComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('member', mockMember);
    fixture.componentRef.setInput('allMembers', [mockMember]);
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call preventDefault and updateMember on save', async () => {
    const event = jasmine.createSpyObj('Event', ['preventDefault']);
    dataManagerServiceMock.updateMember.and.returnValue(Promise.resolve());

    await component.saveMember(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataManagerServiceMock.updateMember).toHaveBeenCalledWith(
      mockMember.id,
      jasmine.objectContaining({ name: 'Test Member' }),
    );
  });

  it('should call addMember if member email is not present', async () => {
    const newMember = {
      ...initMember(),
      name: 'New Member',
      country: 'United States',
    };
    fixture.componentRef.setInput('member', newMember);
    await fixture.whenStable();

    const event = jasmine.createSpyObj('Event', ['preventDefault']);
    dataManagerServiceMock.addMember.and.returnValue(
      Promise.resolve({ id: 'new-id' } as any),
    );

    await component.saveMember(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataManagerServiceMock.addMember).toHaveBeenCalled();
  });
});
