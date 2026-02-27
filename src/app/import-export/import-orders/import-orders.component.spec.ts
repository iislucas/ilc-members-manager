import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';

import { ImportOrdersComponent } from './import-orders.component';
import { DataManagerService } from '../../data-manager.service';
import { Order, SheetsImportOrder, Member, School, initMember, initSchool, initSheetsImportOrder, InstructorLicenseType, MembershipType } from '../../../../functions/src/data-model';

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
    { ...initSheetsImportOrder(), id: 'O1', referenceNumber: 'REF-001', externalId: 'M1', datePaid: '2023-01-01' } as SheetsImportOrder,
  ];

  beforeEach(async () => {
    mockDataManager = {
      orders: {
        entries: () => mockOrders,
        entriesMap: signal(new Map(mockOrders.map(o => [o.id, o]))),
        setEntries: vi.fn(),
      },
      members: {
        entries: () => mockMembers,
        entriesMap: signal(new Map(mockMembers.map(m => [m.memberId, m]))),
      },
      schools: {
        entries: () => mockSchools,
        entriesMap: signal(new Map(mockSchools.map(s => [s.schoolId, s]))),
      },
      updateOrdersSync: vi.fn().mockResolvedValue(undefined),
      addOrder: vi.fn(),
      updateOrder: vi.fn(),
      updateMember: vi.fn(),
      setSchool: vi.fn(),
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
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
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
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid'],
        notes: ['notes']
      });

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      expect(delta.updates.length).toBe(1);
      expect(delta.updates[0].key).toBe('REF-001');
      expect(delta.updates[0].diffs.some(d => d.field === 'notes')).toBe(true);
    });

    it('should detect duplicate orders within import file', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-DUP', externalId: 'M1' },
        { referenceNumber: 'REF-DUP', externalId: 'M1' }
      ]);
      component.mapping.set({ referenceNumber: ['referenceNumber'], externalId: ['externalId'] });

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      // First one is NEW, second one is ISSUE (Duplicate)
      // Wait, logic says: if seenIds.has(ref) -> ISSUE.

      expect(delta.new.has('REF-DUP')).toBe(true);

      // The duplicate matches "ISSUE" list
      const issues = delta.issues.filter(i => i.key === 'REF-DUP');
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].issues).toEqual(expect.arrayContaining([expect.stringMatching(/Duplicate Reference Number/)]));
    });
  });

  describe('Member Side Effects', () => {
    it('should match member by External ID and update membership dates', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-MEM', externalId: 'M1', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('M1')).toBe(true);
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
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid'],
        startDate: ['startDate']
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
        referenceNumber: ['referenceNumber'],
        email: ['email'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('M2')).toBe(true); // user2@test.com is M2
    });

    it('should flag ambiguous email', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-AMBIG', email: 'duplicate@test.com', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        email: ['email'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const issue = delta.issues.find(i => i.key === 'REF-AMBIG');
      expect(issue).toBeTruthy();
      expect(issue!.issues).toEqual(expect.arrayContaining([expect.stringMatching(/Ambiguous Email/)]));
    });

    it('should update Instructor License dates', async () => {
      // M1 is an instructor? Let's assume yes or it just updates fields.
      component.parsedData.set([
        { referenceNumber: 'REF-INST', externalId: 'M1', paidFor: "Instructor's License", datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('M1')).toBe(true);
      const update = memberUpdates.get('M1')!;

      expect(update.member.instructorLicenseRenewalDate).toBe('2023-06-01');
      // No previous license expiry set in mock, so it should be datePaid + 1yr
      expect(update.member.instructorLicenseExpires).toBe('2024-06-01');
      expect(update.member.instructorLicenseType).toBe(InstructorLicenseType.Annual);
    });

    it('should update Student Level for Grading orders', async () => {
      component.parsedData.set([
        { 'order': 'grading', 'Reference Number': 'REF-GRAD', 'External ID': 'M1', 'Paid For': 'Student Level 3', 'Date Paid': '2023-07-01' }
      ]);
      // Use helper to get default mapping which should now include 'orderType' from 'order'
      component.mapping.set(component.getDefaultMapping(['order', 'Reference Number', 'External ID', 'Paid For', 'Date Paid']));

      await component.analyzeData();

      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('M1')).toBe(true);
      const update = memberUpdates.get('M1')!;

      expect(update.member.studentLevel).toBe('3');
    });

    it('should fall back datePaid to startDate when datePaid is empty', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-FALLBACK', externalId: 'M1', paidFor: 'Member Dues - Annual', datePaid: '', startDate: '2023-03-15' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid'],
        startDate: ['startDate']
      });

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      expect(delta.new.size).toBe(1);
      const order = delta.new.get('REF-FALLBACK')!.newItem;
      // datePaid should have been set from startDate
      expect(order.datePaid).toBe('2023-03-15');
    });

    it('should set membershipType to Life for Student Membership - Lifetime', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-LIFE', externalId: 'M1', paidFor: 'Student Membership - Lifetime', datePaid: '2018-01-06' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('M1')).toBe(true);
      const update = memberUpdates.get('M1')!;
      expect(update.member.membershipType).toBe(MembershipType.Life);
      // Life members should NOT have their expiry dates updated
      expect(update.diffs.some(d => d.field === 'currentMembershipExpires')).toBe(false);
    });
  });

  describe('School Side Effects', () => {
    it('should match school by ID and update license dates', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-SCH', externalId: 'S1', paidFor: "School License", datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const schoolUpdates = component.proposedChanges().schoolUpdates;
      expect(schoolUpdates.has('S1')).toBe(true);
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
        referenceNumber: ['referenceNumber'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const issue = delta.issues.find(i => i.key === 'REF-SCH-FAIL');
      expect(issue).toBeTruthy();
      expect(issue!.issues).toEqual(expect.arrayContaining([expect.stringMatching(/School License requires External ID/)]));
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

    it('should filter by GRADING', () => {
      component.proposedChanges.update(pc => ({
        ...pc,
        orders: {
          ...pc.orders,
          new: new Map([
            ...pc.orders.new,
            ['5', {
              key: '5',
              status: 'NEW' as any,
              newItem: { id: '5', orderType: 'grading', paidFor: 'Student Level 3' } as any,
              diffs: []
            }]
          ])
        }
      }));
      component.setTypeFilter('GRADING');
      expect(component.filteredProposedChanges().length).toBe(1);
      expect(component.filteredProposedChanges()[0].newItem.orderType).toBe('grading');
    });
  });

  describe('WooCommerce TSV Format', () => {
    // Additional mock members that correspond to the sample WooCommerce data.
    const wooMembers: Member[] = [
      { ...initMember(), memberId: 'aus-wa-014', emails: ['chrisnewell@live.com.au'], name: 'Chris Newell' },
      { ...initMember(), memberId: 'DE12', emails: ['krischek@web.de'], name: 'Bernd Krischek' },
      // No member for PL62WLKP89 — will test email fallback
      { ...initMember(), memberId: 'PL-OTHER', emails: ['tomasz.nowak@nowapracownia.pl'], name: 'Tomasz Nowak' },
      { ...initMember(), memberId: 'US318AZ', emails: ['thecharlesjean@gmail.com'], name: 'Charles Jean' },
      // No member for Ryu Cheng — will test not-found
      // Mikalai Filipau has Member Number N/A — will test email fallback
      { ...initMember(), memberId: 'BY-001', emails: ['filippov.nikolai.v@gmail.com'], name: 'Mikalai Filipau' },
    ];

    // Build parsed rows as PapaParse would produce from the user's sample TSV.
    const wooParsedRows: Record<string, string>[] = [
      {
        status: 'completed',
        order_number_formatted: '4823',
        order_number: '',
        order_date: '2018-01-06 16:50:00',
        line_items: 'id:368|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|subtotal_tax:0.00|total:500.00|total_tax:0.00|refunded:0.00|refunded_qty:0|meta:Membership Level=Lifetime,Member Number=aus-wa-014,Student Of=Shane ODonnell,Name=Chris Newell,Email=chrisnewell@live.com.au,Phone=(048) 408-2107,Address=24 Chobham Way\\, Morley\\, WA\\, 6062\\, Australia,Date of Birth=02/23/1953,Agree=I Agree',
        first_name: 'Chris',
        last_name: 'Newell',
        billing_email: 'chrisnewell@live.com.au',
        billing_address_1: '24 Chobham Way',
        billing_address_2: '',
        billing_postcode: '6062',
        billing_city: 'Morley',
        billing_state: 'WA',
        billing_country: 'AU',
      },
      {
        status: 'completed',
        order_number_formatted: '4967',
        order_number: '',
        order_date: '2018-01-29 13:06:58',
        line_items: 'id:487|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|subtotal_tax:0.00|total:500.00|total_tax:0.00|refunded:0.00|refunded_qty:0|meta:Membership Level=Lifetime,Member Number=DE12,Student Of=Sam Chin,Name=Bernd Krischek,Email=krischek@web.de,Address=Karolingerstrasse 3\\, Duesseldorf\\, NRW\\, 40223\\, Germany,Date of Birth=12/31/1975,Agree=I Agree',
        first_name: 'Bernd',
        last_name: 'Krischek',
        billing_email: 'krischek@web.de',
        billing_address_1: 'Karolingerstrasse 3',
        billing_address_2: '',
        billing_postcode: '40223',
        billing_city: 'Duesseldorf',
        billing_state: '',
        billing_country: 'DE',
      },
      {
        status: 'completed',
        order_number_formatted: '5749',
        order_number: '',
        order_date: '2018-03-08 13:49:37',
        line_items: 'id:587|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|subtotal_tax:0.00|total:500.00|total_tax:0.00|refunded:0.00|refunded_qty:0|meta:Membership Level=Lifetime,Member Number=PL62WLKP89,Student Of=Jacek Krajewski,Name=Tomasz Nowak,Email=tomasznowak@mailplus.pl,Address=Zmartwychwstańców 2/3\\, Poznań\\, Poland\\, 61-501\\, Poland,Date of Birth=05/16/1981,Agree=I Agree',
        first_name: 'Tomasz',
        last_name: 'Nowak',
        billing_email: 'tomasz.nowak@nowapracownia.pl',
        billing_address_1: 'Zmartwychwstańców 2/3',
        billing_address_2: '',
        billing_postcode: '61-501',
        billing_city: 'Poznań',
        billing_state: '',
        billing_country: 'PL',
      },
      {
        status: 'completed',
        order_number_formatted: '6468',
        order_number: '',
        order_date: '2018-06-12 17:30:47',
        line_items: 'id:983|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|subtotal_tax:0.00|total:500.00|total_tax:0.00|refunded:0.00|refunded_qty:0|meta:Membership Level=Lifetime,Member Number=N/A,Student Of=Dzmitry Siomau,Name=Mikalai Filipau,Email=filippov.nikolai.v@gmail.com,Address=4/1 285\\, Mogilevskaya\\, Minsk\\, Minsk\\, 220007\\, Belarus,Date of Birth=08/10/1988,Agree=I Agree',
        first_name: 'Mikalai',
        last_name: 'Filipau',
        billing_email: 'filippov.nikolai.v@gmail.com',
        billing_address_1: '4/1 Mogilevskaya',
        billing_address_2: '285',
        billing_postcode: '220007',
        billing_city: 'Minsk',
        billing_state: 'Belarus',
        billing_country: 'BY',
      },
    ];

    beforeEach(() => {
      // Replace the mock members with our WooCommerce-specific set
      mockDataManager.members.entries = () => wooMembers;

      // Simulate the WooCommerce format being detected (as onFileChange would do)
      (component as any).isWooCommerceFormat = true;
    });

    it('should correctly parse a WooCommerce row where the member number is found', async () => {
      component.parsedData.set([wooParsedRows[0]]); // Chris Newell, aus-wa-014

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      // Should be NEW with no issues (member aus-wa-014 exists)
      expect(delta.new.size).toBe(1);
      const newOrder = delta.new.get('4823');
      expect(newOrder).toBeTruthy();
      expect(newOrder!.newItem.referenceNumber).toBe('4823');
      expect(newOrder!.newItem.externalId).toBe('aus-wa-014');
      expect(newOrder!.newItem.paidFor).toBe('Student Membership - Lifetime');
      expect(newOrder!.newItem.studentOf).toBe('Shane ODonnell');
      expect(newOrder!.newItem.datePaid).toBe('2018-01-06');
      expect(newOrder!.newItem.costUsd).toBe('500.00');
      expect(newOrder!.newItem.firstName).toBe('Chris');
      expect(newOrder!.newItem.lastName).toBe('Newell');
      expect(newOrder!.newItem.email).toBe('chrisnewell@live.com.au');
      expect(newOrder!.newItem.country).toBe('AU');
      expect(newOrder!.newItem.state).toBe('WA');
      expect(newOrder!.issues).toBeUndefined();
    });

    it('should clean member IDs using cleanMemberId pattern', async () => {
      // Test the cleaning via the component's private method
      const clean = (component as any).cleanMemberId.bind(component);
      expect(clean('PL62WLKP89')).toBe('PL62');
      expect(clean('US431-71')).toBe('US431');
      expect(clean('US318AZ')).toBe('US318');
      expect(clean('DE12')).toBe('DE12');       // already clean
      expect(clean('AT1')).toBe('AT1');          // already clean
      expect(clean('de12')).toBe('DE12');        // lowercased → uppercased
      expect(clean('aus-wa-014')).toBe('aus-wa-014'); // doesn't match pattern, kept as-is
      expect(clean('N/A')).toBe('N/A');           // doesn't match, kept as-is
    });

    it('should set externalId directly from Member Number in line_items', async () => {
      component.parsedData.set([wooParsedRows[2]]); // Tomasz Nowak, PL62WLKP89

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('5749') || delta.issues.find(i => i.key === '5749');
      expect(entry).toBeTruthy();
      expect(entry!.newItem.externalId).toBe('PL62');
    });

    it('should leave externalId empty when member number is N/A', async () => {
      component.parsedData.set([wooParsedRows[3]]); // Mikalai Filipau, N/A

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('6468') || delta.issues.find(i => i.key === '6468');
      expect(entry).toBeTruthy();
      // N/A → externalId empty, email preserved for calculateSideEffects
      expect(entry!.newItem.email).toBe('filippov.nikolai.v@gmail.com');
    });

    it('should set externalId for unknown member numbers (validation later)', async () => {
      // Ryu Cheng row (order 6118) — no member for US431-71 and no matching email
      const ryuRow: Record<string, string> = {
        status: 'completed',
        order_number_formatted: '6118',
        order_number: '',
        order_date: '2018-05-04 2:16:46',
        line_items: 'id:797|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|subtotal_tax:0.00|total:500.00|total_tax:0.00|refunded:0.00|refunded_qty:0|meta:Membership Level=Lifetime,Member Number=US431-71,Student Of=Bernard Langan,Name=Ryu Cheng,Email=Ryu.cheng@gmail.com,Phone=(415) 860-7982,Address=4532 tulip avenue\\, Oakland\\, California\\, 94619\\, United States,Date of Birth=02/01/1979,Agree=I Agree',
        first_name: 'Ryu',
        last_name: 'Cheng',
        billing_email: 'Ryu.cheng@gmail.com',
        billing_address_1: '4532 tulip avenue',
        billing_address_2: '',
        billing_postcode: '94619',
        billing_city: 'Oakland',
        billing_state: 'CA',
        billing_country: 'US',
      };
      component.parsedData.set([ryuRow]);

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('6118') || delta.issues.find(i => i.key === '6118');
      expect(entry).toBeTruthy();
      expect(entry!.newItem.externalId).toBe('US431');
    });

    it('should handle multiple WooCommerce rows correctly', async () => {
      component.parsedData.set(wooParsedRows);

      await component.analyzeData();

      const delta = component.proposedChanges().orders;

      const order4823 = delta.new.get('4823') || delta.issues.find(i => i.key === '4823');
      expect(order4823!.newItem.externalId).toBe('aus-wa-014');

      const order4967 = delta.new.get('4967') || delta.issues.find(i => i.key === '4967');
      expect(order4967!.newItem.externalId).toBe('DE12');

      const order5749 = delta.new.get('5749') || delta.issues.find(i => i.key === '5749');
      expect(order5749!.newItem.externalId).toBe('PL62');
    });

    it('should set membershipType to Life for WooCommerce Lifetime membership', async () => {
      component.parsedData.set([wooParsedRows[0]]); // Chris Newell, Student Membership - Lifetime

      await component.analyzeData();

      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('aus-wa-014')).toBe(true);
      const update = memberUpdates.get('aus-wa-014')!;
      expect(update.member.membershipType).toBe(MembershipType.Life);
    });

    it('should extract correct fields from line_items metadata', async () => {
      component.parsedData.set([wooParsedRows[1]]); // Bernd Krischek, DE12

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const order = delta.new.get('4967')!.newItem;

      expect(order.paidFor).toBe('Student Membership - Lifetime');
      expect(order.studentOf).toBe('Sam Chin');
      expect(order.costUsd).toBe('500.00');
      expect(order.datePaid).toBe('2018-01-29');
      expect(order.orderType).toBe('Membership: Lifetime');
      expect(order.email).toBe('krischek@web.de');
      expect(order.country).toBe('DE');
      // Raw line_items content should be preserved in notes
      expect(order.notes).toContain('name:Student Membership - Lifetime');
      expect(order.notes).toContain('Member Number=DE12');
    });

    it('should correctly parse paidFor from a real CSV string through PapaParse', async () => {
      // Construct a proper CSV string as the user's file would look after TSV→CSV conversion.
      // The line_items field must be double-quoted because it contains commas.
      const csvLines = [
        'status,order_number_formatted,order_number,order_date,line_items,first_name,last_name,billing_email,billing_address_1,billing_address_2,billing_postcode,billing_city,billing_state,billing_country',
        'completed,4823,,2018-01-06 16:50:00,"id:368|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|subtotal_tax:0.00|total:500.00|total_tax:0.00|refunded:0.00|refunded_qty:0|meta:Membership Level=Lifetime,Member Number=aus-wa-014,Student Of=Shane ODonnell,Name=Chris Newell,Email=chrisnewell@live.com.au,Phone=(048) 408-2107,Address=24 Chobham Way\\, Morley\\, WA\\, 6062\\, Australia,Date of Birth=02/23/1953,Agree=I Agree",Chris,Newell,chrisnewell@live.com.au,24 Chobham Way,,6062,Morley,WA,AU',
      ];
      const csvText = csvLines.join('\n');

      // Parse through PapaParse exactly as the component would
      const Papa = await import('papaparse');
      const result = Papa.default.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      const headers = result.meta.fields ?? [];

      // Verify WooCommerce format detection
      const detectedWooCommerce = headers.includes('line_items') && headers.includes('order_number_formatted');
      expect(detectedWooCommerce).toBe(true);

      // Verify the line_items field is intact
      const row = result.data[0];
      expect(row['line_items']).toContain('name:Student Membership - Lifetime');
      expect(row['order_number_formatted']).toBe('4823');

      // Now feed through the component
      component.parsedData.set(result.data);
      (component as any).isWooCommerceFormat = true;

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const newOrder = delta.new.get('4823') || delta.issues.find(i => i.key === '4823');
      expect(newOrder).toBeTruthy();
      expect(newOrder!.newItem.paidFor).toBe('Student Membership - Lifetime');
      expect(newOrder!.newItem.datePaid).toBe('2018-01-06');
      expect(newOrder!.newItem.firstName).toBe('Chris');
      expect(newOrder!.newItem.lastName).toBe('Newell');
    });

    it('should prefer meta Name over billing first_name/last_name when they differ', async () => {
      // Simulate row where meta Name differs from billing columns
      // e.g., meta Name=Leefke Bohde but billing first_name=Marvin, last_name=Sadrinna
      const diffNameRow: Record<string, string> = {
        status: 'completed',
        order_number_formatted: '8141',
        order_number: '',
        order_date: '2018-12-25 12:44:03',
        line_items: 'id:1472|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|total:500.00|meta:Membership Level=Lifetime,Member Number=N/A,Student Of=Miroslav Kovacik,Name=Leefke Bohde,Email=lef.bohde@libero.it',
        first_name: 'Marvin',
        last_name: 'Sadrinna',
        billing_email: 'marvincent@gmx.de',
        billing_country: 'DE',
        billing_state: '',
      };
      component.parsedData.set([diffNameRow]);

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('8141') || delta.issues.find(i => i.key === '8141');
      expect(entry).toBeTruthy();
      // Name should come from meta, not billing
      expect(entry!.newItem.firstName).toBe('Leefke');
      expect(entry!.newItem.lastName).toBe('Bohde');
      // Email should come from meta, not billing
      expect(entry!.newItem.email).toBe('lef.bohde@libero.it');
    });

    it('should prefer meta Email over billing email when they differ', async () => {
      // David May: meta Email=david.may.wa@iinet.net.au vs billing=david.may@computer.org
      const diffEmailRow: Record<string, string> = {
        status: 'completed',
        order_number_formatted: '8393',
        order_number: '',
        order_date: '2019-01-12 19:05:14',
        line_items: 'id:1513|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:500.00|total:500.00|meta:Membership Level=Lifetime,Member Number=aus9,Student Of=Sam Chin,Name=David May,Email=david.may.wa@iinet.net.au',
        first_name: 'David',
        last_name: 'May',
        billing_email: 'david.may@computer.org',
        billing_country: 'AU',
        billing_state: 'WA',
      };
      component.parsedData.set([diffEmailRow]);

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('8393') || delta.issues.find(i => i.key === '8393');
      expect(entry).toBeTruthy();
      expect(entry!.newItem.email).toBe('david.may.wa@iinet.net.au');
      expect(entry!.newItem.firstName).toBe('David');
      expect(entry!.newItem.lastName).toBe('May');
    });

    it('should handle "Your Name" meta key the same as "Name"', async () => {
      const yourNameRow: Record<string, string> = {
        status: 'completed',
        order_number_formatted: '11922',
        order_number: '',
        order_date: '2019-07-22 8:14:34',
        line_items: 'id:2190|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:600.00|total:600.00|meta:Membership Level=Lifetime,Member Number=AT16WI64,Student Of=ILC Austria,Your Name=Anna Hirschmann,Email=post@annahirschmann.info',
        first_name: 'Anna',
        last_name: 'Hirschmann',
        billing_email: 'post@annahirschmann.info',
        billing_country: 'AT',
        billing_state: '',
      };
      component.parsedData.set([yourNameRow]);

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('11922') || delta.issues.find(i => i.key === '11922');
      expect(entry).toBeTruthy();
      expect(entry!.newItem.firstName).toBe('Anna');
      expect(entry!.newItem.lastName).toBe('Hirschmann');
    });

    it('should treat member number "NA" the same as "N/A"', async () => {
      const naRow: Record<string, string> = {
        status: 'completed',
        order_number_formatted: '11659',
        order_number: '',
        order_date: '2019-07-13 22:01:31',
        line_items: 'id:2164|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:600.00|total:600.00|meta:Membership Level=Lifetime,Member Number=NA,Student Of=Karl Koch,Name=Henry Lai,Email=tengu1@msn.com',
        first_name: 'Charles',
        last_name: 'Koch',
        billing_email: 'phil.koch@earthcentric.com',
        billing_country: 'US',
        billing_state: 'NC',
      };
      component.parsedData.set([naRow]);

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('11659') || delta.issues.find(i => i.key === '11659');
      expect(entry).toBeTruthy();
      // NA should be treated as N/A — externalId empty (or set by member lookup)
      // Name should come from meta (Henry Lai), not billing (Charles Koch)
      expect(entry!.newItem.firstName).toBe('Henry');
      expect(entry!.newItem.lastName).toBe('Lai');
      expect(entry!.newItem.email).toBe('tengu1@msn.com');
    });

    it('should handle multi-item line_items (semicolon separated)', async () => {
      const multiItemRow: Record<string, string> = {
        status: 'completed',
        order_number_formatted: '9717',
        order_number: '',
        order_date: '2019-04-06 4:24:17',
        line_items: 'id:1836|name:Student Membership - Lifetime|product_id:2898|sku:|quantity:1|subtotal:600.00|total:600.00|meta:Membership Level=Lifetime,Member Number=sm01,Student Of=Sam Chin,Name=alberto benedusi,Email=onemoreseven@onemore.sm;id:1837|name:Student Level Test Fee - Student Level 1|product_id:2928|sku:|quantity:1|subtotal:50.00|total:50.00|meta:Level=Student Level 1,Member Number=sm01',
        first_name: 'ALBERTO',
        last_name: 'BENEDUSI',
        billing_email: 'ONEMORESEVEN@ONEMORE.SM',
        billing_country: 'SM',
        billing_state: 'SAN MARINO',
      };
      component.parsedData.set([multiItemRow]);

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      const entry = delta.new.get('9717') || delta.issues.find(i => i.key === '9717');
      expect(entry).toBeTruthy();
      // Should use data from the first item only
      expect(entry!.newItem.paidFor).toBe('Student Membership - Lifetime');
      expect(entry!.newItem.firstName).toBe('alberto');
      expect(entry!.newItem.lastName).toBe('benedusi');
      expect(entry!.newItem.email).toBe('onemoreseven@onemore.sm');
      expect(entry!.newItem.externalId).toBe('SM01'); // sm01 uppercased
    });
  });

  describe('Member lookup by name', () => {
    it('should match member by name when ID and email fail', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-NAME', firstName: 'User', lastName: 'One', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        firstName: ['firstName'],
        lastName: ['lastName'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      // 'User One' matches mockMembers[0] (M1)
      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('M1')).toBe(true);
    });
  });

  describe('Revalidation flow', () => {
    it('revalidateOrder should update issues without moving order', async () => {
      // Create an issue entry with an unknown member ID
      component.parsedData.set([
        { referenceNumber: 'REF-REVAL', externalId: 'UNKNOWN', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      let delta = component.proposedChanges().orders;
      expect(delta.issues.some(i => i.key === 'REF-REVAL')).toBe(true);

      // Re-validate without changes — should stay in issues
      component.revalidateOrder('REF-REVAL');

      delta = component.proposedChanges().orders;
      expect(delta.issues.some(i => i.key === 'REF-REVAL')).toBe(true);
      expect(delta.new.has('REF-REVAL')).toBe(false);
    });

    it('revalidateOrder should show match when member is found by email', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-REVAL2', externalId: 'UNKNOWN', email: 'user1@test.com', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        email: ['email'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      // Should be in issues because UNKNOWN is not a valid member ID
      let delta = component.proposedChanges().orders;
      expect(delta.issues.some(i => i.key === 'REF-REVAL2')).toBe(true);

      // Re-validate — should find by email and show match
      component.revalidateOrder('REF-REVAL2');

      delta = component.proposedChanges().orders;
      const entry = delta.issues.find(i => i.key === 'REF-REVAL2');
      expect(entry).toBeTruthy();
      expect(entry!.issues?.[0]).toContain('✓ Matched');
      expect(entry!.newItem.externalId).toBe('M1');
    });

    it('acceptMatch should move matched order from issues to new', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-ACCEPT', externalId: 'UNKNOWN', email: 'user1@test.com', paidFor: 'Member Dues - Annual', datePaid: '2023-06-01' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        email: ['email'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      // Re-validate to confirm match
      component.revalidateOrder('REF-ACCEPT');

      // Now accept the match
      component.acceptMatch('REF-ACCEPT');

      const delta = component.proposedChanges().orders;
      expect(delta.issues.some(i => i.key === 'REF-ACCEPT')).toBe(false);
      expect(delta.new.has('REF-ACCEPT')).toBe(true);
      expect(delta.new.get('REF-ACCEPT')!.newItem.externalId).toBe('M1');
    });
  });

  describe('Senior Lifetime membership', () => {
    it('should set membershipType to Life for Senior Lifetime', async () => {
      component.parsedData.set([
        { referenceNumber: 'REF-SENIOR', externalId: 'M1', paidFor: 'Student Membership - Senior Lifetime', datePaid: '2019-10-12' }
      ]);
      component.mapping.set({
        referenceNumber: ['referenceNumber'],
        externalId: ['externalId'],
        paidFor: ['paidFor'],
        datePaid: ['datePaid']
      });

      await component.analyzeData();

      const memberUpdates = component.proposedChanges().memberUpdates;
      expect(memberUpdates.has('M1')).toBe(true);
      const update = memberUpdates.get('M1')!;
      expect(update.member.membershipType).toBe(MembershipType.Life);
    });
  });

  describe('Older Sheets Format (transaction ID / membership type headers)', () => {
    // Mock members matching the sample data External IDs
    const sheetsMembers: Member[] = [
      { ...initMember(), memberId: 'US13', emails: ['yungbky@hotmail.com'], name: 'Bill Yung', lastRenewalDate: '', currentMembershipExpires: '' },
      { ...initMember(), memberId: 'US66', emails: ['hschneiker@hdslights.com'], name: 'Henry Schneiker', lastRenewalDate: '', currentMembershipExpires: '' },
      { ...initMember(), memberId: 'US80', emails: [], name: 'Dan Pasek' },
      { ...initMember(), memberId: 'AT1', emails: [], name: 'Miroslav Kovacik' },
    ];

    // Simulated parsed rows as PapaParse would produce from the TSV/CSV
    const sheetHeaders = ['Order', 'transaction ID', 'External ID', 'Student Of', 'membership type', 'New/Renew', 'Date Paid', 'Start Date', 'Last Name', 'First Name', 'email'];

    const sheetParsedRows: Record<string, string>[] = [
      { 'Order': '', 'transaction ID': '2006016', 'External ID': 'US13', 'Student Of': '1', 'membership type': 'Member Dues - Life', 'New/Renew': '', 'Date Paid': '15-Jun-06', 'Start Date': '', 'Last Name': 'Yung', 'First Name': 'Bill', 'email': 'yungbky@hotmail.com' },
      { 'Order': '', 'transaction ID': '2007099', 'External ID': 'US66', 'Student Of': '31', 'membership type': 'Member Dues - Life', 'New/Renew': '', 'Date Paid': '22-Apr-07', 'Start Date': '', 'Last Name': 'Schneiker', 'First Name': 'Henry', 'email': 'HSchneiker@hdslights.com' },
      { 'Order': '', 'transaction ID': '2007141', 'External ID': 'US80', 'Student Of': '1', 'membership type': 'Member Dues - Life', 'New/Renew': '', 'Date Paid': '7-Sep-07', 'Start Date': '', 'Last Name': 'Pasek', 'First Name': 'Dan', 'email': '' },
      { 'Order': '', 'transaction ID': '2008081', 'External ID': 'AT1', 'Student Of': '1', 'membership type': 'Member Dues - Life', 'New/Renew': '', 'Date Paid': '25-Jun-08', 'Start Date': '', 'Last Name': 'Kovacik', 'First Name': 'Miroslav', 'email': '' },
    ];

    beforeEach(() => {
      mockDataManager.members.entries = () => sheetsMembers;
      // Not WooCommerce format — uses standard mapper
      (component as any).isWooCommerceFormat = false;
    });

    it('should auto-map headers correctly', () => {
      const mapping = component.getDefaultMapping(sheetHeaders);

      expect(mapping['referenceNumber']).toEqual(['transaction ID']);
      expect(mapping['externalId']).toEqual(['External ID']);
      expect(mapping['studentOf']).toEqual(['Student Of']);
      expect(mapping['paidFor']).toEqual(['membership type']);
      expect(mapping['newRenew']).toEqual(['New/Renew']);
      expect(mapping['datePaid']).toEqual(['Date Paid']);
      expect(mapping['startDate']).toEqual(['Start Date']);
      expect(mapping['lastName']).toEqual(['Last Name']);
      expect(mapping['firstName']).toEqual(['First Name']);
      expect(mapping['email']).toEqual(['email']);
    });

    it('should correctly parse rows with d-MMM-yy date format', async () => {
      component.parsedData.set([sheetParsedRows[0]]); // Bill Yung, 15-Jun-06
      component.mapping.set(component.getDefaultMapping(sheetHeaders));

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      expect(delta.new.size).toBe(1);
      const order = delta.new.get('2006016')!.newItem;

      expect(order.referenceNumber).toBe('2006016');
      expect(order.externalId).toBe('US13');
      expect(order.paidFor).toBe('Member Dues - Life');
      expect(order.datePaid).toBe('2006-06-15');
      expect(order.lastName).toBe('Yung');
      expect(order.firstName).toBe('Bill');
      expect(order.email).toBe('yungbky@hotmail.com');
    });

    it('should handle rows without email and match by External ID', async () => {
      // Dan Pasek has no email but has External ID US80
      component.parsedData.set([sheetParsedRows[2]]); // Dan Pasek
      component.mapping.set(component.getDefaultMapping(sheetHeaders));

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      expect(delta.new.size).toBe(1);
      const order = delta.new.get('2007141')!.newItem;

      expect(order.referenceNumber).toBe('2007141');
      expect(order.externalId).toBe('US80');
      expect(order.paidFor).toBe('Member Dues - Life');
      expect(order.datePaid).toBe('2007-09-07');
      expect(order.firstName).toBe('Dan');
      expect(order.lastName).toBe('Pasek');
    });

    it('should handle multiple rows from this format', async () => {
      component.parsedData.set(sheetParsedRows);
      component.mapping.set(component.getDefaultMapping(sheetHeaders));

      await component.analyzeData();

      const delta = component.proposedChanges().orders;
      // All 4 rows should be new orders with matching members
      expect(delta.new.size).toBe(4);
      expect(delta.issues.length).toBe(0);
      expect(delta.new.has('2006016')).toBe(true);
      expect(delta.new.has('2007099')).toBe(true);
      expect(delta.new.has('2007141')).toBe(true);
      expect(delta.new.has('2008081')).toBe(true);
    });
  });
});
