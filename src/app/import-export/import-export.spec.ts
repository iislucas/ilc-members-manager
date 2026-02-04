import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { ImportExportComponent } from './import-export';
import {
  FirebaseStateService,
  createFirebaseStateServiceMock,
} from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { signal } from '@angular/core';

describe('MemberImportExportComponent', () => {
  let component: ImportExportComponent;
  let fixture: ComponentFixture<ImportExportComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImportExportComponent],
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

    fixture = TestBed.createComponent(ImportExportComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should filter proposed changes by status', async () => {
    // Mock proposed changes
    const mockChanges: any[] = [
      { status: 'NEW', key: 'new@test.com' },
      { status: 'UPDATE', key: 'update@test.com' },
      { status: 'ISSUE', key: 'issue@test.com' },
    ];
    component.proposedChanges.set(mockChanges);
    await fixture.whenStable();

    // Initial state: no filter (Total)
    expect(component.filteredProposedChanges().length).toBe(3);

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

    // Reset filter by clicking same filter again
    component.setFilter('UPDATE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(3);

    // Set filter and then reset by passing null
    component.setFilter('ISSUE');
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(1);
    component.setFilter(null);
    await fixture.whenStable();
    expect(component.filteredProposedChanges().length).toBe(3);
  });

  describe('CSV Mapping and Parsing', () => {
    it('should map "email" header to "emails" field', () => {
      const headers = ['name', 'email', 'memberId'];
      component.importType.set('member');
      const mapping = component.getDefaultMapping(headers);
      expect(mapping['emails']).toBe('email');
    });

    it('should split emails by commas, spaces, and newlines', () => {
      const row = {
        emails:
          'test1@test.com, test2@test.com  test3@test.com\ntest4@test.com',
      };
      const mapping = { emails: 'emails' };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.emails).toEqual([
        'test1@test.com',
        'test2@test.com',
        'test3@test.com',
        'test4@test.com',
      ]);
    });

    it('should mark ISSUE if memberId is missing', async () => {
      component.importType.set('member');
      component.parsedData.set([{ name: 'No ID', emails: 'test@test.com' }]);
      component.mapping.set({ name: 'name', emails: 'emails' });

      await component.analyzeData();

      const changes = component.proposedChanges();
      expect(changes.length).toBe(1);
      expect(changes[0].status).toBe('ISSUE');
      expect(changes[0].issues).toContain('Member ID is required');
    });

    it('should trim string fields', () => {
      const row = {
        name: '  John Doe  ',
        memberId: '  M123  ',
      };
      const mapping = { name: 'name', memberId: 'memberId' };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.name).toBe('John Doe');
      expect(member.memberId).toBe('M123');
    });

    it('should skip rows that contain only empty strings or whitespace', async () => {
      component.importType.set('member');
      component.parsedData.set([
        { name: '  ', memberId: '' },
        { name: 'John', memberId: 'M1' },
      ]);
      component.mapping.set({ name: 'name', memberId: 'memberId' });

      await component.analyzeData();

      const changes = component.proposedChanges();
      expect(changes.length).toBe(1);
      expect(changes[0].key).toBe('M1');
    });

    it('should lowercase emails during parsing', () => {
      const row = {
        emails: 'Test1@Test.com, TEST2@test.com',
        publicEmail: 'Public@Test.com',
      };
      const mapping = { emails: 'emails', publicEmail: 'publicEmail' };
      const { member } = (component as any).mapRowToMember(row, mapping);
      expect(member.emails).toEqual(['test1@test.com', 'test2@test.com']);
      expect(member.publicEmail).toBe('public@test.com');
    });

    it('should lowercase school emails during parsing', () => {
      const row = {
        ownerEmail: 'Owner@Test.com',
        managerEmails: 'Manager1@Test.com, MANAGER2@test.com',
      };
      const mapping = {
        ownerEmail: 'ownerEmail',
        managerEmails: 'managerEmails',
      };
      const school = (component as any).mapRowToSchool(row, mapping);
      expect(school.ownerEmail).toBe('owner@test.com');
      expect(school.managerEmails).toEqual([
        'manager1@test.com',
        'manager2@test.com',
      ]);
    });

    it('should flag duplicate memberIds in the same import file', async () => {
      component.importType.set('member');
      component.parsedData.set([
        { name: 'User 1', memberId: 'M1' },
        { name: 'User 2', memberId: 'M1' }, // Duplicate
      ]);
      component.mapping.set({ name: 'name', memberId: 'memberId' });

      await component.analyzeData();

      const changes = component.proposedChanges();
      expect(changes.length).toBe(2);
      expect(changes[0].status).toBe('NEW');
      expect(changes[1].status).toBe('ISSUE');
      expect(changes[1].issues).toContain('Duplicate ID in import file');
    });

    it('should flag duplicate schoolIds in the same import file', async () => {
      component.importType.set('school');
      component.parsedData.set([
        { schoolName: 'School 1', schoolId: 'S1' },
        { schoolName: 'School 2', schoolId: 'S1' }, // Duplicate
      ]);
      component.mapping.set({ schoolName: 'schoolName', schoolId: 'schoolId' });

      await component.analyzeData();

      const changes = component.proposedChanges();
      expect(changes.length).toBe(2);
      expect(changes[0].status).toBe('NEW');
      expect(changes[1].status).toBe('ISSUE');
      expect(changes[1].issues).toContain('Duplicate ID in import file');
    });
  });
});
