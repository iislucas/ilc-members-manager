import { describe, it, expect } from 'vitest';
import { parseGradingOrderInfo } from './grading';
import { SquareSpaceOrder, SquareSpaceLineItem } from '../data-model';

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
      gradingInfo: {
        docId: '',
        lastUpdated: expect.any(String),
        gradingPurchaseDate: '2026-02-22',
        orderId: '699b9753b4562909908cae78',
        level: 'Student 7',
        gradingInstructorId: '1',
        assistantInstructorIds: [],
        schoolId: '',
        studentMemberId: 'US402',
        studentMemberDocId: '',
        status: 'pending',
        gradingEventDate: '',
        notes: 'Evaluating Instructor Name: Sam Chin',
        gradingEvent: 'Sam Chin Poland Retreat in November 2026'
      }
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
      gradingInfo: {
        docId: '',
        lastUpdated: expect.any(String),
        gradingPurchaseDate: '2024-05-01',
        orderId: '123',
        level: 'Generic Grading',
        gradingInstructorId: '',
        assistantInstructorIds: [],
        schoolId: '',
        studentMemberId: '',
        studentMemberDocId: '',
        status: 'in-review',
        gradingEventDate: '',
        notes: '',
        gradingEvent: ''
      }
    });
  });
});
