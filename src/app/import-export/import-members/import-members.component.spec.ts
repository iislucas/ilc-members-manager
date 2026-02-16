import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ImportMembersComponent } from './import-members.component';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { signal } from '@angular/core';

describe('ImportMembersComponent', () => {
  let component: ImportMembersComponent;
  let fixture: ComponentFixture<ImportMembersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportMembersComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: FirebaseStateService,
          useValue: createFirebaseStateServiceMock(),
        },
        {
          provide: DataManagerService,
          useValue: {
            countries: { entries: signal([]) },
            members: {
              entriesMap: signal(new Map()),
            },
            schools: {
              entries: signal([]),
              entriesMap: signal(new Map()),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportMembersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter proposed changes by status', async () => {
    // Mock proposed changes
    const mockDelta: any = {
      issues: [{ status: 'ISSUE', key: 'issue@test.com' }],
      updates: [{ status: 'UPDATE', key: 'update@test.com' }],
      unchanged: [],
      new: new Map([['new@test.com', { status: 'NEW', key: 'new@test.com' }]]),
      seenIds: new Set(),
    };
    component.proposedChanges.set(mockDelta);
    await fixture.whenStable();

    // Initial state: default filter is ISSUE
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('ISSUE');

    // Filter by NEW
    component.setFilter('NEW');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('NEW');

    // Filter by UPDATE
    component.setFilter('UPDATE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('UPDATE');

    // Reset filter by clicking same filter again (goes back to ISSUE)
    component.setFilter('UPDATE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('ISSUE');

    // Set filter to ISSUES explicitly
    component.setFilter('ISSUE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    expect(component.filteredProposedChanges()[0].status).toBe('ISSUE');
  });

  describe('CSV Mapping and Parsing', () => {
    it('should map "email" header to "emails" field', () => {
      const headers = ['name', 'email', 'memberId'];
      const mapping = component.getDefaultMapping(headers);
      expect(mapping['emails']).toEqual(['email']);
    });

    it('should split emails by commas, spaces, and newlines', () => {
      const row = {
        emails:
          'test1@test.com, test2@test.com  test3@test.com\ntest4@test.com',
      };
      const mapping = { emails: ['emails'] };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.emails).toEqual([
        'test1@test.com',
        'test2@test.com',
        'test3@test.com',
        'test4@test.com',
      ]);
    });

    it('should mark ISSUE if memberId is missing', async () => {
      component.parsedData.set([{ name: 'No ID', emails: 'test@test.com' }]);
      component.mapping.set({ name: ['name'], emails: ['emails'] });

      await component.analyzeData();

      const delta = component.proposedChanges() as any;
      expect(delta.issues.length).toBe(1);
      expect(delta.issues[0].status).toBe('ISSUE');
      expect(delta.issues[0].issues).toContain('Member ID is required');
    });

    it('should trim string fields', () => {
      const row = {
        name: '  John Doe  ',
        memberId: '  M123  ',
      };
      const mapping = { name: ['name'], memberId: ['memberId'] };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.name).toBe('John Doe');
      expect(member.memberId).toBe('M123');
    });

    it('should skip rows that contain only empty strings or whitespace', async () => {
      component.parsedData.set([
        { name: '  ', memberId: '' },
        { name: 'John', memberId: 'M1' },
      ]);
      component.mapping.set({ name: ['name'], memberId: ['memberId'] });

      await component.analyzeData();

      const delta = component.proposedChanges() as any;
      expect(delta.new.size).toBe(1);
      const newMember = delta.new.get('M1');
      expect(newMember).toBeTruthy();
      expect(newMember.key).toBe('M1');
    });

    it('should lowercase emails during parsing', () => {
      const row = {
        emails: 'Test1@Test.com, TEST2@test.com',
        publicEmail: 'Public@Test.com',
      };
      const mapping = { emails: ['emails'], publicEmail: ['publicEmail'] };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.emails).toEqual(['test1@test.com', 'test2@test.com']);
      expect(member.publicEmail).toBe('public@test.com');
    });

    it('should flag duplicate memberIds in the same import file', async () => {
      component.parsedData.set([
        { name: 'User 1', memberId: 'M1' },
        { name: 'User 2', memberId: 'M1' }, // Duplicate
      ]);
      component.mapping.set({ name: ['name'], memberId: ['memberId'] });

      await component.analyzeData();

      const delta = component.proposedChanges() as any;
      // Both duplicates become issues in member logic
      expect(delta.new.size).toBe(0);
      expect(delta.issues.length).toBe(2);
      expect(delta.issues[0].status).toBe('ISSUE');
      expect(delta.issues[1].status).toBe('ISSUE');
      expect(delta.issues[1].issues).toContain('Duplicate ID (M1) in import file');
    });

    it('should parse dates into YYYY-MM-DD format', () => {
      const row = {
        firstMembershipStarted: '02/01/2023', // DD/MM/YYYY -> 2023-01-02
        lastRenewalDate: '2023-05-15', // YYYY-MM-DD -> 2023-05-15
        dateOfBirth: '1990/12/31', // YYYY/MM/DD -> 1990-12-31
        currentMembershipExpires: 'invalid-date',
      };
      const mapping = {
        firstMembershipStarted: ['firstMembershipStarted'],
        lastRenewalDate: ['lastRenewalDate'],
        dateOfBirth: ['dateOfBirth'],
        currentMembershipExpires: ['currentMembershipExpires'],
      };

      const { member, issues } = (component as any).mapRowToMember(row, mapping);

      expect(member.firstMembershipStarted).toBe('2023-01-02');
      expect(member.lastRenewalDate).toBe('2023-05-15');
      expect(member.dateOfBirth).toBe('1990-12-31');
      // For invalid date, it keeps original value but adds an issue
      expect(member.currentMembershipExpires).toBe('invalid-date');
      expect(issues.length).toBe(1);
      expect(issues[0]).toContain('Invalid date format');
    });

    it('should parse DD-Mon-YYYY format', () => {
      const row = {
        dateOfBirth: '23-Feb-1953',
      };
      const mapping = {
        dateOfBirth: ['dateOfBirth'],
      };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.dateOfBirth).toBe('1953-02-23');
    });

    it('should parse year-only format as Jan 1st', () => {
      const row = {
        dateOfBirth: '1953',
      };
      const mapping = {
        dateOfBirth: ['dateOfBirth'],
      };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.dateOfBirth).toBe('1953-01-01');
    });

    it('should set currentMembershipExpires to 1 year after lastRenewalDate if MembershipType is Annual', () => {
      const row = {
        lastRenewalDate: '2023-01-01',
        membershipType: 'Annual',
      };
      const mapping = {
        lastRenewalDate: ['lastRenewalDate'],
        membershipType: ['membershipType'],
      };

      // We expect currentMembershipExpires to automatically be set
      const { member } = (component as any).mapRowToMember(row, mapping);

      expect(member.lastRenewalDate).toBe('2023-01-01');
      // 1 year after 2023-01-01 is 2024-01-01
      expect(member.currentMembershipExpires).toBe('2024-01-01');
    });
  });
});
