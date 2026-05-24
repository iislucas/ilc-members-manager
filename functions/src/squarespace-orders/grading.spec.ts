import { describe, it, expect, vi } from 'vitest';
import { parseGradingOrderInfo, processGradingOrder } from './grading';
import { SquareSpaceOrder, SquareSpaceLineItem, GradingStatus } from '../data-model';
import * as admin from 'firebase-admin';

describe('parseGradingOrderInfo', () => {
  it('should correctly parse a grading order line item based on a real example', () => {
    const orderData = {
      docId: '699b9753b4562909908cae78',
      orderNumber: '14',
      createdOn: '2026-02-22T23:54:59.673Z',
      modifiedOn: '2026-02-22T23:54:59.953Z',
      customerEmail: 'lucas.dixon@iliqchuan.com',
      lastUpdated: '2026-02-22T23:54:59.953Z',
    } as SquareSpaceOrder;

    const gradingItem = {
      id: '699b970af7cf551e039ed675',
      productId: '68abe24c78e7345c36e3d386',
      productName: 'GRADING : Student Levels',
      variantOptions: [
        {
          optionName: 'Level',
          value: 'Student Level 7'
        }
      ],
      customizations: [
        {
          label: 'Name',
          value: 'Lucas Dixon'
        },
        {
          label: 'Member ID',
          value: 'US402'
        },
        {
          label: 'Email',
          value: 'lucas.dixon@gmail.com'
        },
        {
          label: 'Current Student Level',
          value: 'Student Level 6'
        },
        {
          label: 'Current Application Level',
          value: 'Application Level 3'
        },
        {
          label: 'Grading Event',
          value: 'Sam Chin Poland Retreat in November 2026'
        },
        {
          label: 'Evaluating Instructor Name',
          value: 'Sam Chin'
        },
        {
          label: 'Evaluating Instructor Instructor ID',
          value: '1'
        }
      ],
    } as SquareSpaceLineItem;

    const parsed = parseGradingOrderInfo(orderData, gradingItem);

    expect(parsed).toEqual({
      email: 'lucas.dixon@gmail.com',
      currentStudentLevel: 'Student 6',
      currentApplicationLevel: 'Application 3',
      gradingInfo: expect.objectContaining({
        docId: '',
        lastUpdated: expect.any(String),
        gradingPurchaseDate: '2026-02-22',
        orderId: '699b9753b4562909908cae78',
        level: 'Student 7',
        gradingInstructorId: '1',
        assistantInstructorIds: [],
        schoolId: '',
        schoolDocId: '',
        studentMemberId: 'US402',
        studentMemberDocId: '',
        status: 'pending',
        gradingEventDate: '',
        notes: 'Evaluating Instructor Name: Sam Chin',
        gradingEvent: 'Sam Chin Poland Retreat in November 2026'
      })
    });
  });

  it('should correctly map various level formats to canonical representation', () => {
    const orderData = { docId: 'o1', customerEmail: 'a@b.com', lastUpdated: '2026-02-22' } as SquareSpaceOrder;

    const testLevels = [
      { input: 'Student Level 1', expected: 'Student 1' },
      { input: 'Application Level 2', expected: 'Application 2' },
      { input: 'Student 3', expected: 'Student 3' },
      { input: 'Application 4', expected: 'Application 4' },
      { input: 'Entry', expected: 'Student Entry' },
      { input: 'Entry Level', expected: 'Student Entry' },
      { input: '5', expected: 'Student 5' },
    ];

    for (const { input, expected } of testLevels) {
      const item = {
        variantOptions: [{ optionName: 'Level', value: input }]
      } as SquareSpaceLineItem;
      const parsed = parseGradingOrderInfo(orderData, item);
      expect(parsed.gradingInfo.level).toBe(expected);
    }
  });

  it('should fall back to customerEmail and productName if fields are missing', () => {
    const orderData = {
      docId: '123',
      customerEmail: 'test@example.com',
      createdOn: '2024-05-01T12:00:00Z',
      lastUpdated: '2024-05-01T12:00:00Z'
    } as SquareSpaceOrder;

    const gradingItem = {
      productName: 'Generic Grading',
      customizations: []
    } as unknown as SquareSpaceLineItem;

    const parsed = parseGradingOrderInfo(orderData, gradingItem);

    expect(parsed).toEqual({
      email: 'test@example.com',
      currentStudentLevel: '',
      currentApplicationLevel: '',
      gradingInfo: expect.objectContaining({
        docId: '',
        lastUpdated: expect.any(String),
        gradingPurchaseDate: '2024-05-01',
        orderId: '123',
        level: 'Generic Grading',
        gradingInstructorId: '',
        assistantInstructorIds: [],
        schoolId: '',
        schoolDocId: '',
        studentMemberId: '',
        studentMemberDocId: '',
        status: 'in-review',
        gradingEventDate: '',
        notes: '',
        gradingEvent: ''
      })
    });
  });
});

describe('processGradingOrder', () => {
  it('should successfully process a grading purchase without an instructor selected', async () => {
    const orderData = {
      docId: 'order-doc-1',
      orderNumber: '14',
      createdOn: '2026-02-22T23:54:59.673Z',
      modifiedOn: '2026-02-22T23:54:59.953Z',
      customerEmail: 'lucas.dixon@iliqchuan.com',
      lastUpdated: '2026-02-22T23:54:59.953Z',
    } as SquareSpaceOrder;

    const gradingItem = {
      id: 'line-item-1',
      productId: 'prod-1',
      productName: 'GRADING : Student Levels',
      variantOptions: [{ optionName: 'Level', value: 'Student Level 7' }],
      customizations: [
        { label: 'Name', value: 'Lucas Dixon' },
        { label: 'Member ID', value: 'US402' },
        { label: 'Email', value: 'lucas.dixon@gmail.com' },
        { label: 'Current Student Level', value: 'Student Level 6' },
        { label: 'Current Application Level', value: 'Application Level 3' },
      ],
    } as SquareSpaceLineItem;

    const mockStudentDocUpdate = vi.fn().mockResolvedValue({});
    const mockStudentDoc = {
      id: 'student-doc-id',
      ref: {
        id: 'student-doc-id',
        update: mockStudentDocUpdate,
      },
      data: () => ({
        memberId: 'US402',
        emails: ['lucas.dixon@gmail.com'],
        studentLevel: 'Student Level 6',
        applicationLevel: 'Application Level 3',
        name: 'Lucas Dixon',
      }),
    };

    const mockGet = vi.fn().mockImplementation(async function (this: any) {
      const filters = this._filters || [];
      const memberIdFilter = filters.find((f: any) => f.field === 'memberId');
      const orderIdFilter = filters.find((f: any) => f.field === 'orderId');

      if (orderIdFilter) {
        return { empty: true, docs: [] };
      }

      if (memberIdFilter && memberIdFilter.value === 'US402') {
        return { empty: false, docs: [mockStudentDoc] };
      }

      return { empty: true, docs: [] };
    });

    const mockSet = vi.fn().mockResolvedValue({});
    const mockDoc = vi.fn().mockReturnValue({
      id: 'new-grading-doc-id',
      set: mockSet,
    });

    function createQueryMock(filters: any[] = []): any {
      return {
        _filters: filters,
        where: function (field: string, op: string, value: any) {
          return createQueryMock([...filters, { field, op, value }]);
        },
        limit: function () {
          return this;
        },
        get: mockGet,
        doc: mockDoc,
      };
    }

    const mockDb = {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'members' || name === 'gradings') {
          return createQueryMock();
        }
        return {
          doc: mockDoc,
        };
      }),
    } as unknown as admin.firestore.Firestore;

    const result = await processGradingOrder(orderData, 'order-doc-1', gradingItem, mockDb);

    expect(result).toEqual({ kind: 'success', gradingDocId: 'new-grading-doc-id' });
    expect(mockSet).toHaveBeenCalled();
    const savedGrading = mockSet.mock.calls[0][0];
    expect(savedGrading.status).toBe(GradingStatus.AwaitingRequest);
    expect(savedGrading.studentMemberDocId).toBe('student-doc-id');
    expect(savedGrading.studentMemberId).toBe('US402');
    expect(mockStudentDocUpdate).toHaveBeenCalled();
  });

  it('should successfully process a grading purchase with a valid instructor ID selected', async () => {
    const orderData = {
      docId: 'order-doc-1',
      orderNumber: '14',
      createdOn: '2026-02-22T23:54:59.673Z',
      modifiedOn: '2026-02-22T23:54:59.953Z',
      customerEmail: 'lucas.dixon@iliqchuan.com',
      lastUpdated: '2026-02-22T23:54:59.953Z',
    } as SquareSpaceOrder;

    const gradingItem = {
      id: 'line-item-1',
      productId: 'prod-1',
      productName: 'GRADING : Student Levels',
      variantOptions: [{ optionName: 'Level', value: 'Student Level 7' }],
      customizations: [
        { label: 'Name', value: 'Lucas Dixon' },
        { label: 'Member ID', value: 'US402' },
        { label: 'Email', value: 'lucas.dixon@gmail.com' },
        { label: 'Current Student Level', value: 'Student Level 6' },
        { label: 'Current Application Level', value: 'Application Level 3' },
        { label: 'Evaluating Instructor Instructor ID', value: 'Sam Chin [1]' },
      ],
    } as SquareSpaceLineItem;

    const mockStudentDocUpdate = vi.fn().mockResolvedValue({});
    const mockStudentDoc = {
      id: 'student-doc-id',
      ref: {
        id: 'student-doc-id',
        update: mockStudentDocUpdate,
      },
      data: () => ({
        memberId: 'US402',
        emails: ['lucas.dixon@gmail.com'],
        studentLevel: 'Student Level 6',
        applicationLevel: 'Application Level 3',
        name: 'Lucas Dixon',
      }),
    };

    const mockInstructorDoc = {
      id: 'instructor-doc-id',
      data: () => ({
        memberId: 'US1',
        instructorId: '1',
        name: 'Sam Chin',
      }),
    };

    const mockGet = vi.fn().mockImplementation(async function (this: any) {
      const filters = this._filters || [];
      const memberIdFilter = filters.find((f: any) => f.field === 'memberId');
      const instructorIdFilter = filters.find((f: any) => f.field === 'instructorId');
      const orderIdFilter = filters.find((f: any) => f.field === 'orderId');

      if (orderIdFilter) {
        return { empty: true, docs: [] };
      }

      if (memberIdFilter && memberIdFilter.value === 'US402') {
        return { empty: false, docs: [mockStudentDoc] };
      }

      if (instructorIdFilter && instructorIdFilter.value === '1') {
        return { empty: false, docs: [mockInstructorDoc] };
      }

      return { empty: true, docs: [] };
    });

    const mockSet = vi.fn().mockResolvedValue({});
    const mockDoc = vi.fn().mockReturnValue({
      id: 'new-grading-doc-id',
      set: mockSet,
    });

    function createQueryMock(filters: any[] = []): any {
      return {
        _filters: filters,
        where: function (field: string, op: string, value: any) {
          return createQueryMock([...filters, { field, op, value }]);
        },
        limit: function () {
          return this;
        },
        get: mockGet,
        doc: mockDoc,
      };
    }

    const mockDb = {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'members' || name === 'gradings') {
          return createQueryMock();
        }
        return {
          doc: mockDoc,
        };
      }),
    } as unknown as admin.firestore.Firestore;

    const result = await processGradingOrder(orderData, 'order-doc-1', gradingItem, mockDb);

    expect(result).toEqual({ kind: 'success', gradingDocId: 'new-grading-doc-id' });
    expect(mockSet).toHaveBeenCalled();
    const savedGrading = mockSet.mock.calls[0][0];
    expect(savedGrading.status).toBe(GradingStatus.AwaitingAcceptance);
    expect(savedGrading.gradingInstructorId).toBe('1');
    expect(savedGrading.studentMemberDocId).toBe('student-doc-id');
    expect(savedGrading.studentMemberId).toBe('US402');
  });

  it('should fall back to AwaitingRequest if the selected instructor ID is invalid', async () => {
    const orderData = {
      docId: 'order-doc-1',
      orderNumber: '14',
      createdOn: '2026-02-22T23:54:59.673Z',
      modifiedOn: '2026-02-22T23:54:59.953Z',
      customerEmail: 'lucas.dixon@iliqchuan.com',
      lastUpdated: '2026-02-22T23:54:59.953Z',
    } as SquareSpaceOrder;

    const gradingItem = {
      id: 'line-item-1',
      productId: 'prod-1',
      productName: 'GRADING : Student Levels',
      variantOptions: [{ optionName: 'Level', value: 'Student Level 7' }],
      customizations: [
        { label: 'Name', value: 'Lucas Dixon' },
        { label: 'Member ID', value: 'US402' },
        { label: 'Email', value: 'lucas.dixon@gmail.com' },
        { label: 'Current Student Level', value: 'Student Level 6' },
        { label: 'Current Application Level', value: 'Application Level 3' },
        { label: 'Evaluating Instructor Instructor ID', value: '999' },
      ],
    } as SquareSpaceLineItem;

    const mockStudentDocUpdate = vi.fn().mockResolvedValue({});
    const mockStudentDoc = {
      id: 'student-doc-id',
      ref: {
        id: 'student-doc-id',
        update: mockStudentDocUpdate,
      },
      data: () => ({
        memberId: 'US402',
        emails: ['lucas.dixon@gmail.com'],
        studentLevel: 'Student Level 6',
        applicationLevel: 'Application Level 3',
        name: 'Lucas Dixon',
      }),
    };

    const mockGet = vi.fn().mockImplementation(async function (this: any) {
      const filters = this._filters || [];
      const memberIdFilter = filters.find((f: any) => f.field === 'memberId');
      const instructorIdFilter = filters.find((f: any) => f.field === 'instructorId');
      const orderIdFilter = filters.find((f: any) => f.field === 'orderId');

      if (orderIdFilter) {
        return { empty: true, docs: [] };
      }

      if (memberIdFilter && memberIdFilter.value === 'US402') {
        return { empty: false, docs: [mockStudentDoc] };
      }

      if (instructorIdFilter && instructorIdFilter.value === '999') {
        return { empty: true, docs: [] };
      }

      return { empty: true, docs: [] };
    });

    const mockSet = vi.fn().mockResolvedValue({});
    const mockDoc = vi.fn().mockReturnValue({
      id: 'new-grading-doc-id',
      set: mockSet,
    });

    function createQueryMock(filters: any[] = []): any {
      return {
        _filters: filters,
        where: function (field: string, op: string, value: any) {
          return createQueryMock([...filters, { field, op, value }]);
        },
        limit: function () {
          return this;
        },
        get: mockGet,
        doc: mockDoc,
      };
    }

    const mockDb = {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'members' || name === 'gradings') {
          return createQueryMock();
        }
        return {
          doc: mockDoc,
        };
      }),
    } as unknown as admin.firestore.Firestore;

    const result = await processGradingOrder(orderData, 'order-doc-1', gradingItem, mockDb);

    expect(result).toEqual({ kind: 'success', gradingDocId: 'new-grading-doc-id' });
    expect(mockSet).toHaveBeenCalled();
    const savedGrading = mockSet.mock.calls[0][0];
    expect(savedGrading.status).toBe(GradingStatus.AwaitingRequest);
    expect(savedGrading.gradingInstructorId).toBe('999');
  });

  it('should create a grading doc in RequiresReview status with a descriptive reviewIssue when the student is not found', async () => {
    const orderData = {
      docId: 'order-doc-2',
      orderNumber: '15',
      createdOn: '2026-02-22T23:54:59.673Z',
      modifiedOn: '2026-02-22T23:54:59.953Z',
      customerEmail: 'unknown@example.com',
      lastUpdated: '2026-02-22T23:54:59.953Z',
    } as SquareSpaceOrder;

    const gradingItem = {
      id: 'line-item-2',
      productId: 'prod-1',
      productName: 'GRADING : Student Levels',
      variantOptions: [{ optionName: 'Level', value: 'Student Level 7' }],
      customizations: [
        { label: 'Name', value: 'Unknown Student' },
        { label: 'Member ID', value: 'US999' },
        { label: 'Email', value: 'unknown@example.com' },
      ],
    } as SquareSpaceLineItem;

    // Mock members lookup to return empty snapshot (student not found)
    const mockGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });

    const mockSet = vi.fn().mockResolvedValue({});
    const mockDoc = vi.fn().mockReturnValue({
      id: 'new-grading-doc-id',
      set: mockSet,
    });

    function createQueryMock(): any {
      return {
        where: function () {
          return this;
        },
        limit: function () {
          return this;
        },
        get: mockGet,
        doc: mockDoc,
      };
    }

    const mockDb = {
      collection: vi.fn().mockImplementation((name) => {
        if (name === 'members' || name === 'gradings') {
          return createQueryMock();
        }
        return {
          doc: mockDoc,
        };
      }),
    } as unknown as admin.firestore.Firestore;

    const result = await processGradingOrder(orderData, 'order-doc-2', gradingItem, mockDb);

    expect(result).toEqual({ kind: 'success', gradingDocId: 'new-grading-doc-id' });
    expect(mockSet).toHaveBeenCalled();
    const savedGrading = mockSet.mock.calls[0][0];
    expect(savedGrading.status).toBe(GradingStatus.RequiresReview);
    expect(savedGrading.studentMemberDocId).toBe('');
    expect(savedGrading.reviewIssue).toContain('Member ID US999 not found in database');
  });
});

