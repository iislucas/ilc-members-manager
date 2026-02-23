import { describe, it, expect } from 'vitest';
import { parseGradingOrderInfo, SquareSpaceOrder, SquareSpaceLineItem } from './squarespace-orders';

describe('squarespace-orders', () => {
  describe('parseGradingOrderInfo', () => {
    it('should correctly parse a grading order line item based on a real example', () => {
      const orderData: SquareSpaceOrder = {
        id: "699b9753b4562909908cae78",
        orderNumber: "14",
        createdOn: "2026-02-22T23:54:59.673Z",
        modifiedOn: "2026-02-22T23:54:59.953Z",
        customerEmail: "lucas.dixon@iliqchuan.com",
      };

      const gradingItem: SquareSpaceLineItem = {
        id: "699b970af7cf551e039ed675",
        productId: "68abe24c78e7345c36e3d386",
        productName: "GRADING : Student Levels",
        variantOptions: [
          {
            optionName: "Level",
            value: "Student Level 7"
          }
        ],
        customizations: [
          {
            label: "Name of person being graded",
            value: "Lucas Dixon"
          },
          {
            label: "Member ID of the person being graded",
            value: "US402"
          },
          {
            label: "Email of person being graded",
            value: "lucas.dixon@gmail.com"
          },
          {
            label: "Current Student Level",
            value: "Student Level 6"
          },
          {
            label: "Current Application Level",
            value: "Application Level 3"
          },
          {
            label: "Where / when are you planning to grade?",
            value: "Sam Chin Poland Retreat in November 2026"
          },
          {
            label: " Name of the Evaluating Instructor",
            value: "Sam Chin"
          },
          {
            label: "InstructorID of the evaluating instructor",
            value: "1"
          }
        ],
      };

      const parsed = parseGradingOrderInfo(orderData, gradingItem);

      expect(parsed).toEqual({
        email: 'lucas.dixon@gmail.com',
        currentStudentLevel: 'Student Level 6',
        currentApplicationLevel: 'Application Level 3',
        gradingInfo: {
          id: '',
          lastUpdated: expect.any(String),
          gradingPurchaseDate: '2026-02-22',
          orderId: '699b9753b4562909908cae78',
          level: 'Student Level 7',
          gradingInstructorId: '1',
          assistantInstructorIds: [],
          schoolId: '',
          studentMemberId: 'US402',
          studentMemberDocId: '',
          status: 'pending',
          gradingEventDate: '',
          notes: "Evaluating Instructor Name: Sam Chin",
          gradingEvent: "Sam Chin Poland Retreat in November 2026"
        }
      });
    });

    it('should fall back to customerEmail and productName if fields are missing', () => {
      const orderData: SquareSpaceOrder = {
        id: '123',
        customerEmail: "test@example.com",
        createdOn: "2024-05-01T12:00:00Z"
      };

      const gradingItem: SquareSpaceLineItem = {
        productName: "Generic Grading",
        customizations: []
      };

      const parsed = parseGradingOrderInfo(orderData, gradingItem);

      expect(parsed).toEqual({
        email: 'test@example.com',
        currentStudentLevel: '',
        currentApplicationLevel: '',
        gradingInfo: {
          id: '',
          lastUpdated: expect.any(String),
          gradingPurchaseDate: '2024-05-01',
          orderId: '123',
          level: 'Generic Grading',
          gradingInstructorId: '',
          assistantInstructorIds: [],
          schoolId: '',
          studentMemberId: '',
          studentMemberDocId: '',
          status: 'requiresReview',
          gradingEventDate: '',
          notes: '',
          gradingEvent: ''
        }
      });
    });
  });
});
