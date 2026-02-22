import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Mock } from 'vitest';
import { MemberEditComponent } from './member-edit';
import { DataManagerService, DataServiceState } from '../data-manager.service';
import {
  FirebaseStateService,
  UserDetails,
  createFirebaseStateServiceMock,
} from '../firebase-state.service';
import { ROUTING_CONFIG, initPathPatterns } from '../app.config';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  initMember,
  Member,
  MembershipType,
  School,
  InstructorPublicData,
} from '../../../functions/src/data-model';
import { SearchableSet } from '../searchable-set';
import { CountryCode } from '../country-codes';
import { User } from 'firebase/auth';

describe('MemberEditComponent', () => {
  let component: MemberEditComponent;
  let fixture: ComponentFixture<MemberEditComponent>;
  let dataManagerServiceMock: DataManagerService;
  let firebaseStateServiceMock: FirebaseStateService;

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
    dataManagerServiceMock = {
      updateMember: vi.fn(),
      addMember: vi.fn(),
      createNextMemberId: vi.fn(),
      createNextInstructorId: vi.fn(),
      loadingState: signal(DataServiceState.Loaded),
      members: new SearchableSet<'memberId', Member>(
        ['name'],
        'memberId',
        [],
      ),
      instructors: new SearchableSet<'instructorId', InstructorPublicData>(
        ['name'],
        'instructorId',
        [],
      ),
      schools: new SearchableSet<'schoolId', School>(
        ['schoolName'],
        'schoolId',
        [],
      ),
      countries: new SearchableSet<'id', CountryCode>(['name'], 'id', []),
      counters: signal(null),
    } as Partial<DataManagerService> as DataManagerService;

    dataManagerServiceMock.countries.setEntries([
      { id: 'US', name: 'United States' },
    ]);

    firebaseStateServiceMock = createFirebaseStateServiceMock();
    firebaseStateServiceMock.user.set({
      isAdmin: true,
      member: mockMember,
      schoolsManaged: [],
      firebaseUser: { email: 'admin@example.com' } as User,
      memberProfiles: [],
    } as UserDetails);

    await TestBed.configureTestingModule({
      imports: [MemberEditComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: dataManagerServiceMock },
        { provide: FirebaseStateService, useValue: firebaseStateServiceMock },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
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
    const event = { preventDefault: vi.fn() } as unknown as Event;
    (dataManagerServiceMock.updateMember as Mock).mockResolvedValue(undefined);

    await component.saveMember(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataManagerServiceMock.updateMember).toHaveBeenCalledWith(
      mockMember.id,
      expect.objectContaining({ name: 'Test Member' }),
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

    const event = { preventDefault: vi.fn() } as unknown as Event;
    (dataManagerServiceMock.addMember as Mock).mockResolvedValue({ id: 'new-id' });

    await component.saveMember(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(dataManagerServiceMock.addMember).toHaveBeenCalled();
  });
});
