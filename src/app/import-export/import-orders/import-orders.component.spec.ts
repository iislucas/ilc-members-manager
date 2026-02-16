import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';

import { ImportOrdersComponent } from './import-orders.component';
import { DataManagerService } from '../../data-manager.service';
import { Order, Member, School, initMember, initSchool, initOrder, InstructorLicenseType } from '../../../../functions/src/data-model';

describe('ImportOrdersComponent', () => {
  let component: ImportOrdersComponent;
  let fixture: ComponentFixture<ImportOrdersComponent>;
  let mockDataManager: any;

  // Test Data
  const mockMembers: Member[] = [
    { ...initMember(), memberId: 'M1', emails: ['user1@test.com'], name: 'User One', lastRenewalDate: '2022-01-01', currentMembershipExpires: '2023-01-01' },
    { ...initMember(), memberId: 'M2', emails: ['user2@test.com'], name: 'User Two' },
    { ...initMember(), memberId: 'M3', emails: ['duplicate@test.com'], name: 'Dup One' },
    { ...initMember(), memberId: 'M4', emails: ['duplicate@test.com'], name: 'Dup Two' }, // Ambiguous email
  ];
  
  const mockSchools: School[] = [
    { ...initSchool(), schoolId: 'S1', schoolName: 'School One', schoolLicenseRenewalDate: '2022-05-01', schoolLicenseExpires: '2023-05-01' },
  ];

  const mockOrders: Order[] = [
    { ...initOrder(), id: 'O1', referenceNumber: 'REF-001', externalId: 'M1', datePaid: '2023-01-01' },
  ];

  beforeEach(async () => {
    mockDataManager = {
      orders: {
        entries: () => mockOrders,
        entriesMap: signal(new Map(mockOrders.map(o => [o.id, o]))),
        setEntries: jasmine.createSpy('setEntries'),
      },
      members: {
        entries: () => mockMembers,
        entriesMap: signal(new Map(mockMembers.map(m => [m.memberId, m]))),
      },
      schools: {
        entries: () => mockSchools,
        entriesMap: signal(new Map(mockSchools.map(s => [s.schoolId, s]))),
      },
      updateOrdersSync: jasmine.createSpy('updateOrdersSync').and.returnValue(Promise.resolve(undefined)),
      addOrder: jasmine.createSpy('addOrder'),
      updateOrder: jasmine.createSpy('updateOrder'),
      updateMember: jasmine.createSpy('updateMember'),
      setSchool: jasmine.createSpy('setSchool'),
    };

    await TestBed.configureTestingModule({
      imports: [ImportOrdersComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DataManagerService, useValue: mockDataManager },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImportOrdersComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Order Analysis', () => {

    it('should detect new orders', async () => {
      // Setup input data
      component.parsedData.set([
        { referenceNumber: 'REF-NEW', externalId: 'M1', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: 'referenceNumber',
        externalId: 'externalId',
        paidFor: 'paidFor',
        datePaid: 'datePaid'
      });

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      expect(delta.new.size).toBe(1);
      const newOrder = delta.new.get('REF-NEW');
      expect(newOrder).toBeTruthy();
      expect(newOrder!.newItem.referenceNumber).toBe('REF-NEW');
    });

    it('should detect existing orders (UPDATE)', async () => {
        // Mock existing order is REF-001 (from beforeEach)
        // New data has different amount or something
        component.parsedData.set([
          { referenceNumber: 'REF-001', externalId: 'M1', paidFor: 'Member Dues - Annual', datePaid: '2023-01-01', notes: 'Updated Note' }
        ]);
        component.mapping.set({
          referenceNumber: 'referenceNumber',
          externalId: 'externalId',
          paidFor: 'paidFor',
          datePaid: 'datePaid',
          notes: 'notes'
        });
  
        await component.analyzeData();
  
        const delta = component.proposedChanges().orders;
        expect(delta.updates.length).toBe(1);
        expect(delta.updates[0].key).toBe('REF-001');
        expect(delta.updates[0].diffs.some(d => d.field === 'notes')).toBeTrue();
      });

    it('should detect duplicate orders within import file', async () => {
        component.parsedData.set([
            { referenceNumber: 'REF-DUP', externalId: 'M1' },
            { referenceNumber: 'REF-DUP', externalId: 'M1' }
        ]);
        component.mapping.set({ referenceNumber: 'referenceNumber', externalId: 'externalId' });

        await component.analyzeData();
        
        const delta = component.proposedChanges().orders;
        // First one is NEW, second one is ISSUE (Duplicate)
        // Wait, logic says: if seenIds.has(ref) -> ISSUE.
        
        expect(delta.new.has('REF-DUP')).toBeTrue();
        
        // The duplicate matches "ISSUE" list
        const issues = delta.issues.filter(i => i.key === 'REF-DUP');
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].issues).toContain(jasmine.stringMatching(/Duplicate Reference Number/));
    });
  });

  describe('Member Side Effects', () => {
      it('should match member by External ID and update membership dates', async () => {
          component.parsedData.set([
            { referenceNumber: 'REF-MEM', externalId: 'M1', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
          ]);
          component.mapping.set({
            referenceNumber: 'referenceNumber',
            externalId: 'externalId',
            paidFor: 'paidFor',
            datePaid: 'datePaid'
          });
    
          await component.analyzeData();
    
          const memberUpdates = component.proposedChanges().memberUpdates;
          expect(memberUpdates.has('M1')).toBeTrue();
          const update = memberUpdates.get('M1')!;
          
          // M1 prev expires: 2023-01-01. Paid: 2023-06-01.
          // New expiry should be 2023-06-01 + 1yr = 2024-06-01.
          // Logic: max(paid+1yr, current+1yr). current+1yr = 2024-01-01.
          // max(2024-06-01, 2024-01-01) = 2024-06-01.
          
          expect(update.member.lastRenewalDate).toBe('2023-06-01');
          expect(update.member.currentMembershipExpires).toBe('2024-06-01');
      });

      it('should use the MAX of startDate, datePaid, and currentExpiry + 1yr for new expiry', async () => {
        // M1 expires 2023-01-01.
        // Order paid 2023-02-01
        // Order start 2023-03-01
        // Expect: 2024-03-01 (2023-03-01 + 1yr)
        
        component.parsedData.set([
            { referenceNumber: 'REF-MAX', externalId: 'M1', paidFor: 'Member Dues - Annual', datePaid: '2023-02-01', startDate: '2023-03-01' }
        ]);
        component.mapping.set({
            referenceNumber: 'referenceNumber',
            externalId: 'externalId',
            paidFor: 'paidFor',
            datePaid: 'datePaid',
            startDate: 'startDate'
        });

        await component.analyzeData();

        const memberUpdates = component.proposedChanges().memberUpdates;
        const update = memberUpdates.get('M1')!;
        
        expect(update.member.currentMembershipExpires).toBe('2024-03-01');
      });

      it('should match member by Email if External ID is missing', async () => {
        component.parsedData.set([
          { referenceNumber: 'REF-EMAIL', email: 'user2@test.com', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
        ]);
        component.mapping.set({
          referenceNumber: 'referenceNumber',
          email: 'email',
          paidFor: 'paidFor',
          datePaid: 'datePaid'
        });
  
        await component.analyzeData();
  
        const memberUpdates = component.proposedChanges().memberUpdates;
        expect(memberUpdates.has('M2')).toBeTrue(); // user2@test.com is M2
      });

      it('should flag ambiguous email', async () => {
        component.parsedData.set([
          { referenceNumber: 'REF-AMBIG', email: 'duplicate@test.com', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
        ]);
        component.mapping.set({
          referenceNumber: 'referenceNumber',
          email: 'email',
          paidFor: 'paidFor',
          datePaid: 'datePaid'
        });
  
        await component.analyzeData();
  
        const delta = component.proposedChanges().orders;
        const issue = delta.issues.find(i => i.key === 'REF-AMBIG');
        expect(issue).toBeTruthy();
        expect(issue!.issues).toContain(jasmine.stringMatching(/Ambiguous Email/));
      });

      it('should update Instructor License dates', async () => {
        // M1 is an instructor? Let's assume yes or it just updates fields.
        component.parsedData.set([
            { referenceNumber: 'REF-INST', externalId: 'M1', paidFor: "Instructor's License", datePaid: '2023-06-01' }
        ]);
        component.mapping.set({
            referenceNumber: 'referenceNumber',
            externalId: 'externalId',
            paidFor: 'paidFor',
            datePaid: 'datePaid'
        });

        await component.analyzeData();

        const memberUpdates = component.proposedChanges().memberUpdates;
        expect(memberUpdates.has('M1')).toBeTrue();
        const update = memberUpdates.get('M1')!;
        
        expect(update.member.instructorLicenseRenewalDate).toBe('2023-06-01');
        // No previous license expiry set in mock, so it should be datePaid + 1yr
        expect(update.member.instructorLicenseExpires).toBe('2024-06-01');
        expect(update.member.instructorLicenseType).toBe(InstructorLicenseType.Annual);
      });
  });

  describe('School Side Effects', () => {
      it('should match school by ID and update license dates', async () => {
        component.parsedData.set([
            { referenceNumber: 'REF-SCH', externalId: 'S1', paidFor: "School License", datePaid: '2023-06-01' }
        ]);
        component.mapping.set({
            referenceNumber: 'referenceNumber',
            externalId: 'externalId',
            paidFor: 'paidFor',
            datePaid: 'datePaid'
        });

        await component.analyzeData();

        const schoolUpdates = component.proposedChanges().schoolUpdates;
        expect(schoolUpdates.has('S1')).toBeTrue();
        const update = schoolUpdates.get('S1')!;

        // S1 prev expires: 2023-05-01. Paid: 2023-06-01.
        // New expiry: max(paid+1yr, current+1yr)
        // paid+1yr = 2024-06-01.
        // current+1yr = 2024-05-01.
        // Result: 2024-06-01.
        
        expect(update.school.schoolLicenseRenewalDate).toBe('2023-06-01');
        expect(update.school.schoolLicenseExpires).toBe('2024-06-01');
      });

      it('should fail if School License order has no External ID', async () => {
        component.parsedData.set([
            { referenceNumber: 'REF-SCH-FAIL', paidFor: "School License", datePaid: '2023-06-01' }
        ]);
        component.mapping.set({
            referenceNumber: 'referenceNumber',
            paidFor: 'paidFor',
            datePaid: 'datePaid'
        });

        await component.analyzeData();

        const delta = component.proposedChanges().orders;
        const issue = delta.issues.find(i => i.key === 'REF-SCH-FAIL');
        expect(issue).toBeTruthy();
        expect(issue!.issues).toContain(jasmine.stringMatching(/School License requires External ID/));
      });
  });

  describe('Filtering by Type', () => {
    beforeEach(() => {
        // Setup some mock data with different types
        component.proposedChanges.set({
            orders: {
                new: new Map([
                    ['1', { 
                        key: '1',
                        action: 'NEW',
                        status: 'NEW' as any, 
                        newItem: { id: '1', paidFor: 'Member Dues - Annual' } as any, 
                        originalItem: undefined, 
                        issues: [],
                        diffs: []
                    }],
                    ['2', { 
                        key: '2',
                        action: 'NEW', 
                        status: 'NEW' as any,
                        newItem: { id: '2', paidFor: 'School License - Annual' } as any, 
                        originalItem: undefined, 
                        issues: [],
                        diffs: []
                    }],
                    ['3', { 
                        key: '3',
                        action: 'NEW', 
                        status: 'NEW' as any,
                        newItem: { id: '3', paidFor: 'Instructor License' } as any, 
                        originalItem: undefined, 
                        issues: [],
                        diffs: []
                    }],
                    ['4', { 
                        key: '4',
                        action: 'NEW', 
                        status: 'NEW' as any,
                        newItem: { id: '4', paidFor: 'Unknown Stuff' } as any, 
                        originalItem: undefined, 
                        issues: [],
                        diffs: []
                    }]
                ]),
                updates: [],
                issues: [],
                unchanged: [],
                seenIds: new Set()
            },
            memberUpdates: new Map(),
            schoolUpdates: new Map()
        });
        
        // Default status filter is 'ISSUE', set it to 'NEW' to see our items
        component.selectedStatusFilter.set('NEW');
    });

    it('should show all items when filter is ALL', () => {
        component.setTypeFilter('ALL');
        expect(component.filteredProposedChanges().length).toBe(4);
    });

    it('should filter by MEMBERSHIP', () => {
        component.setTypeFilter('MEMBERSHIP');
        expect(component.filteredProposedChanges().length).toBe(1);
        expect(component.filteredProposedChanges()[0].newItem.paidFor).toBe('Member Dues - Annual');
    });

    it('should filter by SCHOOL_LICENSE', () => {
        component.setTypeFilter('SCHOOL_LICENSE');
        expect(component.filteredProposedChanges().length).toBe(1);
        expect(component.filteredProposedChanges()[0].newItem.paidFor).toBe('School License - Annual');
    });

    it('should filter by INSTRUCTOR_LICENSE', () => {
        component.setTypeFilter('INSTRUCTOR_LICENSE');
        expect(component.filteredProposedChanges().length).toBe(1);
        expect(component.filteredProposedChanges()[0].newItem.paidFor).toBe('Instructor License');
    });

    it('should filter by OTHER', () => {
        component.setTypeFilter('OTHER');
        expect(component.filteredProposedChanges().length).toBe(1);
        expect(component.filteredProposedChanges()[0].newItem.paidFor).toBe('Unknown Stuff');
    });

    it('should calculate stats correctly', () => {
        const stats = component.stats();
        expect(stats.ALL).toBe(4);
        expect(stats.MEMBERSHIP).toBe(1);
        expect(stats.SCHOOL_LICENSE).toBe(1);
        expect(stats.INSTRUCTOR_LICENSE).toBe(1);
        expect(stats.OTHER).toBe(1);
    });
  });
});
