import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { sendTransactionalEmail } from './email-dispatcher';
import { environment } from './environment/environment';

describe('sendTransactionalEmail', () => {
  let mockDb: any;
  let mockMailAdd: any;
  let mockTemplatesDocGet: any;

  beforeEach(() => {
    mockMailAdd = vi.fn().mockResolvedValue({ id: 'mail-doc-123' });
    mockTemplatesDocGet = vi.fn().mockResolvedValue({
      exists: false,
      data: () => ({}),
    });

    mockDb = {
      doc: vi.fn().mockReturnValue({
        get: mockTemplatesDocGet,
      }),
      collection: vi.fn().mockReturnValue({
        add: mockMailAdd,
      }),
    } as unknown as admin.firestore.Firestore;
  });

  it('enqueues transactional email to /mail with formatted subject and body', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'orders@iliqchuan.com';

    try {
      const mailId = await sendTransactionalEmail(mockDb, {
        to: 'member@example.com',
        templateKey: 'orderConfirmation',
        replacements: {
          name: 'Jane Doe',
          orderNumber: 'ORD-9876',
          orderDate: '2026-09-12',
          amount: '45.00',
          currency: 'USD',
          itemsSummary: 'Annual Membership Renewal',
          receiptUrl: '',
          appBase: 'https://app.iliqchuan.com',
        },
      });

      expect(mailId).toBe('mail-doc-123');
      expect(mockDb.collection).toHaveBeenCalledWith('mail');
      expect(mockMailAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['member@example.com'],
          from: 'orders@iliqchuan.com',
          message: expect.objectContaining({
            subject: expect.stringContaining('ORD-9876'),
            text: expect.stringContaining('Jane Doe'),
            html: expect.stringContaining('Jane Doe'),
          }),
          metadata: expect.objectContaining({
            templateKey: 'orderConfirmation',
          }),
        }),
      );
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('uses custom template overrides when present in system/email-templates', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'orders@iliqchuan.com';

    mockTemplatesDocGet.mockResolvedValue({
      exists: true,
      data: () => ({
        eventRegistrationConfirmationSubject: 'Custom Registration Subject: {eventTitle}',
        eventRegistrationConfirmationBody: 'Hello {name}, you are in for **{eventTitle}** on {eventDates}.',
      }),
    });

    try {
      await sendTransactionalEmail(mockDb, {
        to: 'student@example.com',
        templateKey: 'eventRegistrationConfirmation',
        replacements: {
          name: 'Sam Student',
          eventTitle: 'Masterclass NYC',
          eventDates: 'Oct 10, 2026',
        },
      });

      expect(mockMailAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['student@example.com'],
          message: expect.objectContaining({
            subject: 'Custom Registration Subject: Masterclass NYC',
            text: 'Hello Sam Student, you are in for **Masterclass NYC** on Oct 10, 2026.',
            html: expect.stringContaining('<strong>Masterclass NYC</strong>'),
          }),
        }),
      );
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('skips enqueueing if environment.email.from is empty', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = '';

    try {
      const mailId = await sendTransactionalEmail(mockDb, {
        to: 'member@example.com',
        templateKey: 'orderConfirmation',
        replacements: { name: 'Test' },
      });

      expect(mailId).toBeNull();
      expect(mockMailAdd).not.toHaveBeenCalled();
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('skips enqueueing if recipient list is empty or has invalid emails', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'orders@iliqchuan.com';

    try {
      const mailId = await sendTransactionalEmail(mockDb, {
        to: ['invalid-address', ''],
        templateKey: 'orderConfirmation',
        replacements: { name: 'Test' },
      });

      expect(mailId).toBeNull();
      expect(mockMailAdd).not.toHaveBeenCalled();
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('enqueues placeholder document with status PAUSED when sending is globally paused', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'orders@iliqchuan.com';

    mockDb.doc = vi.fn().mockImplementation((path: string) => {
      if (path === 'system/mail-settings') {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ sendingPaused: true }),
          }),
        };
      }
      return {
        get: mockTemplatesDocGet,
      };
    });

    try {
      const mailId = await sendTransactionalEmail(mockDb, {
        to: 'member@example.com',
        templateKey: 'orderConfirmation',
        replacements: {
          name: 'Paused Member',
          orderNumber: 'ORD-1111',
        },
      });

      expect(mailId).toBe('mail-doc-123');
      expect(mockMailAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['member@example.com'],
          status: 'PAUSED',
          templateKey: 'orderConfirmation',
          templateData: {
            name: 'Paused Member',
            orderNumber: 'ORD-1111',
          },
          delivery: expect.objectContaining({
            state: 'PAUSED',
          }),
          message: expect.objectContaining({
            text: '',
            html: '',
          }),
        }),
      );
    } finally {
      environment.email.from = originalFrom;
    }
  });
});

