import { describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  sendSmtpEmail,
  MailQueueDoc,
  sendAdminTestEmail,
  retryMailItem,
  setMailSendingPaused,
  setMailSendingState,
  deleteMailItems,
  updateMailItem,
  processMailQueue,
  MailSendingStatus,
} from './mail-processor';
import * as common from './common';
import { environment } from './environment/environment';
import type { Transporter } from 'nodemailer';

describe('mail-processor', () => {
  it('dispatches email with correctly mapped fields', async () => {
    const mockSendMail = vi.fn().mockResolvedValue({
      messageId: 'msg_12345',
      response: '250 OK',
      accepted: ['student@example.com'],
    });
    const mockTransporter = {
      sendMail: mockSendMail,
    } as unknown as Transporter;

    const doc: MailQueueDoc = {
      to: 'student@example.com',
      from: 'info@iliqchuan.com',
      replyTo: 'support@iliqchuan.com',
      message: {
        subject: 'Order Confirmation #1001',
        text: 'Thank you for your order.',
        html: '<p>Thank you for your order.</p>',
      },
    };

    const result = await sendSmtpEmail(mockTransporter, doc, 'I Liq Chuan Association');

    expect(result.messageId).toBe('msg_12345');
    expect(mockSendMail).toHaveBeenCalledWith({
      from: '"I Liq Chuan Association" <info@iliqchuan.com>',
      to: 'student@example.com',
      replyTo: 'support@iliqchuan.com',
      subject: 'Order Confirmation #1001',
      text: 'Thank you for your order.',
      html: '<p>Thank you for your order.</p>',
    });
  });

  it('joins array recipients into a comma-separated string', async () => {
    const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg_multi' });
    const mockTransporter = {
      sendMail: mockSendMail,
    } as unknown as Transporter;

    const doc: MailQueueDoc = {
      to: ['user1@example.com', 'user2@example.com'],
      message: {
        subject: 'Upcoming Events Digest',
        text: 'Upcoming events list...',
        html: '<p>Upcoming events list...</p>',
      },
    };

    await sendSmtpEmail(mockTransporter, doc, 'I Liq Chuan Association');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user1@example.com, user2@example.com',
        subject: 'Upcoming Events Digest',
      }),
    );
  });

  it('uses root subject/text/html if message sub-object is missing', async () => {
    const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg_legacy' });
    const mockTransporter = {
      sendMail: mockSendMail,
    } as unknown as Transporter;

    const doc: MailQueueDoc = {
      to: 'member@example.com',
      subject: 'Direct Subject',
      text: 'Direct Text',
      html: '<p>Direct HTML</p>',
    };

    await sendSmtpEmail(mockTransporter, doc, 'I Liq Chuan Association');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'member@example.com',
        subject: 'Direct Subject',
        text: 'Direct Text',
        html: '<p>Direct HTML</p>',
      }),
    );
  });

  it('propagates transporter errors properly', async () => {
    const mockSendMail = vi.fn().mockRejectedValue(new Error('SMTP connection timed out'));
    const mockTransporter = {
      sendMail: mockSendMail,
    } as unknown as Transporter;

    const doc: MailQueueDoc = {
      to: 'fail@example.com',
      subject: 'Test',
    };

    await expect(sendSmtpEmail(mockTransporter, doc, 'I Liq Chuan Association')).rejects.toThrow(
      'SMTP connection timed out',
    );
  });

  it('throws an error if from address is not specified in doc and environment.email.from is empty', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = '';
    try {
      const mockTransporter = {
        sendMail: vi.fn(),
      } as unknown as Transporter;

      const doc: MailQueueDoc = {
        to: 'user@example.com',
        subject: 'No From Test',
      };

      await expect(sendSmtpEmail(mockTransporter, doc, 'I Liq Chuan Association')).rejects.toThrow(
        'No sender "from" address specified in mail document or environment.email.from',
      );
    } finally {
      environment.email.from = originalFrom;
    }
  });

  describe('sendAdminTestEmail', () => {
    it('throws unauthenticated or permission-denied if assertAdmin rejects', async () => {
      vi.spyOn(common, 'assertAdmin').mockRejectedValue(
        new HttpsError('permission-denied', 'Admin access required.'),
      );

      await expect(
        sendAdminTestEmail.run({
          auth: { token: { email: 'user@example.com' } },
          data: { to: 'test@example.com', subject: 'Hi', bodyMarkdown: 'Hello' },
        } as any),
      ).rejects.toThrow('Admin access required.');
    });

    it('validates required fields', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);

      await expect(
        sendAdminTestEmail.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { to: '', subject: 'Hi', bodyMarkdown: 'Hello' },
        } as any),
      ).rejects.toThrow('Recipient (to), subject, and bodyMarkdown are all required.');
    });

    it('rejects invalid recipient email formats', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);

      await expect(
        sendAdminTestEmail.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { to: 'not-an-email', subject: 'Hi', bodyMarkdown: 'Hello' },
        } as any),
      ).rejects.toThrow('Invalid recipient email address');
    });

    it('throws failed-precondition if environment.email.from is not configured', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const originalFrom = environment.email.from;
      environment.email.from = '';
      try {
        await expect(
          sendAdminTestEmail.run({
            auth: { token: { email: 'admin@iliqchuan.com' } },
            data: { to: 'admin@iliqchuan.com', subject: 'Hi', bodyMarkdown: 'Hello' },
          } as any),
        ).rejects.toThrow('No sender "from" address configured in environment.email.from');
      } finally {
        environment.email.from = originalFrom;
      }
    });


    it('enqueues test email to /mail collection and returns success when processed', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockDocRef = {
        id: 'mail_test_123',
        get: vi.fn().mockResolvedValue({
          data: () => ({
            delivery: {
              state: 'SUCCESS',
              info: {
                messageId: 'msg_test_123',
                simulated: true,
              },
            },
          }),
        }),
      };
      const mockAdd = vi.fn().mockResolvedValue(mockDocRef);
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          add: mockAdd,
        }),
      } as any);

      const res = await sendAdminTestEmail.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: {
          to: 'admin@iliqchuan.com',
          subject: 'Test Subject',
          bodyMarkdown: '**Hello**\nThis is a test.',
        },
      } as any);

      expect(res.success).toBe(true);
      expect(res.simulated).toBe(true);
      expect(res.messageId).toBe('msg_test_123');
      expect(res.docId).toBe('mail_test_123');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['admin@iliqchuan.com'],
          from: 'notifications@iliqchuan.com',
          replyTo: 'web-helper-team@iliqchuan.com',
          status: 'PENDING',
          delivery: expect.objectContaining({
            state: 'PENDING',
          }),
          message: {
            subject: 'Test Subject',
            text: '**Hello**\nThis is a test.',
            html: '<strong>Hello</strong><br>This is a test.',
          },
          metadata: expect.objectContaining({
            adminTest: true,
            requestedBy: 'admin@iliqchuan.com',
          }),
        }),
      );
    });

    it('substitutes {name} and tokens in subject and bodyMarkdown before queuing', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockDocRef = {
        id: 'mail_test_token',
        get: vi.fn().mockResolvedValue({
          data: () => ({
            status: 'SUCCESS',
            delivery: {
              state: 'SUCCESS',
              info: { messageId: 'msg_test_tok', simulated: true },
            },
          }),
        }),
      };
      const mockAdd = vi.fn().mockResolvedValue(mockDocRef);
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          add: mockAdd,
        }),
      } as any);

      const res = await sendAdminTestEmail.run({
        auth: { token: { email: 'admin@iliqchuan.com', name: 'Master Sam Chin' } },
        data: {
          to: 'test@example.com',
          name: 'Alex Chen',
          subject: 'Welcome {name}!',
          bodyMarkdown: 'Hello **{name}**,\n\nOrder {orderNumber} for {amount}. Visit [ILC]({appBase}).',
        },
      } as any);

      expect(res.success).toBe(true);
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          to: ['test@example.com'],
          message: {
            subject: 'Welcome Alex Chen!',
            text: 'Hello **Alex Chen**,\n\nOrder 1001 for $120.00. Visit [ILC](https://app.iliqchuan.com).',
            html: 'Hello <strong>Alex Chen</strong>,<br><br>Order 1001 for $120.00. Visit <a href="https://app.iliqchuan.com">ILC</a>.',
          },
        }),
      );
    });

    it('returns error when mail queue delivery fails', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockDocRef = {
        id: 'mail_test_fail',
        get: vi.fn().mockResolvedValue({
          data: () => ({
            status: 'ERROR',
            delivery: {
              state: 'ERROR',
              error: 'Invalid SMTP credentials',
            },
          }),
        }),
      };
      const mockAdd = vi.fn().mockResolvedValue(mockDocRef);
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          add: mockAdd,
        }),
      } as any);

      const res = await sendAdminTestEmail.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: {
          to: 'admin@iliqchuan.com',
          subject: 'Test Subject',
          bodyMarkdown: 'Hello',
        },
      } as any);

      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid SMTP credentials');
      expect(res.docId).toBe('mail_test_fail');
    });
  });

  describe('retryMailItem', () => {
    it('rejects non-admin callers', async () => {
      vi.spyOn(common, 'assertAdmin').mockRejectedValue(
        new HttpsError('permission-denied', 'Admin access required.'),
      );

      await expect(
        retryMailItem.run({
          auth: { token: { email: 'member@example.com' } },
          data: { mailId: 'mail_123' },
        } as any),
      ).rejects.toThrow('Admin access required.');
    });

    it('validates mailId presence', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);

      await expect(
        retryMailItem.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailId: '' },
        } as any),
      ).rejects.toThrow('Document ID (mailId) is required.');
    });

    it('throws not-found when document does not exist', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockDoc = {
        get: vi.fn().mockResolvedValue({ exists: false }),
      };
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue(mockDoc),
        }),
      } as any);

      await expect(
        retryMailItem.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailId: 'nonexistent_mail' },
        } as any),
      ).rejects.toThrow('Mail document "nonexistent_mail" not found.');
    });

    it('throws failed-precondition if mail is already PROCESSING', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockDoc = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ status: 'PROCESSING', delivery: { state: 'PROCESSING' } }),
        }),
      };
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue(mockDoc),
        }),
      } as any);

      await expect(
        retryMailItem.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailId: 'in_flight_mail' },
        } as any),
      ).rejects.toThrow('Mail document "in_flight_mail" is currently being processed.');
    });

    it('resets status to PENDING and clears error on retry', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockUpdate = vi.fn().mockResolvedValue({});
      const mockDoc = {
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ status: 'ERROR', delivery: { state: 'ERROR', error: 'Timed out' } }),
        }),
        update: mockUpdate,
      };
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue(mockDoc),
        }),
      } as any);

      const res = await retryMailItem.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: { mailId: 'mail_retry_123' },
      } as any);

      expect(res.success).toBe(true);
      expect(res.docId).toBe('mail_retry_123');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PENDING',
          'delivery.state': 'PENDING',
          'delivery.error': null,
          'delivery.retryRequestedBy': 'admin@iliqchuan.com',
        }),
      );
    });
  });

  describe('processMailQueue circular prevention & status guards', () => {
    it('skips processing if document status is already SUCCESS or PROCESSING or ERROR', async () => {
      const mockUpdate = vi.fn();
      const mockDocRef = { update: mockUpdate };

      // Case 1: SUCCESS
      await (processMailQueue as any).run({
        data: {
          after: {
            exists: true,
            ref: mockDocRef,
            data: () => ({ status: 'SUCCESS', to: 'a@example.com' }),
          },
        },
        params: { mailId: 'doc_success' },
      });

      // Case 2: ERROR
      await (processMailQueue as any).run({
        data: {
          after: {
            exists: true,
            ref: mockDocRef,
            data: () => ({ status: 'ERROR', to: 'b@example.com' }),
          },
        },
        params: { mailId: 'doc_error' },
      });

      // Case 3: PROCESSING
      await (processMailQueue as any).run({
        data: {
          after: {
            exists: true,
            ref: mockDocRef,
            data: () => ({ status: 'PROCESSING', to: 'c@example.com' }),
          },
        },
        params: { mailId: 'doc_processing' },
      });

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('sets document to PAUSED and stops if mail sending is globally paused', async () => {
      const mockUpdate = vi.fn();
      const mockDocRef = { update: mockUpdate };

      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return {
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ status: MailSendingStatus.Paused }),
              }),
            };
          }
          return { get: vi.fn() };
        }),
      } as any);

      await (processMailQueue as any).run({
        data: {
          after: {
            exists: true,
            ref: mockDocRef,
            data: () => ({ status: 'PENDING', to: 'paused@example.com' }),
          },
        },
        params: { mailId: 'mail_paused_1' },
      });

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'PAUSED',
        'delivery.state': 'PAUSED',
      });
    });

    it('skips processing without updating document if mail sending is OFF and not an admin test', async () => {
      const mockUpdate = vi.fn();
      const mockDocRef = { update: mockUpdate };

      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return {
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ status: MailSendingStatus.Off }),
              }),
            };
          }
          return { get: vi.fn() };
        }),
      } as any);

      await (processMailQueue as any).run({
        data: {
          after: {
            exists: true,
            ref: mockDocRef,
            data: () => ({ status: 'PENDING', to: 'off@example.com' }),
          },
        },
        params: { mailId: 'mail_off_1' },
      });

      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('bypasses OFF and PAUSED checks when document has metadata.adminTest = true', async () => {
      const mockUpdate = vi.fn();
      const mockDocRef = { update: mockUpdate };

      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return {
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () => ({ status: MailSendingStatus.Off }),
              }),
            };
          }
          return { get: vi.fn() };
        }),
        runTransaction: vi.fn().mockImplementation(async (cb) => {
          return await cb({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ status: 'PENDING', to: 'admin@iliqchuan.com' }),
            }),
            update: mockUpdate,
          });
        }),
      } as any);

      // In test/emulator without SMTP_PASSWORD, it locks and simulates success
      await (processMailQueue as any).run({
        data: {
          after: {
            exists: true,
            ref: mockDocRef,
            data: () => ({
              status: 'PENDING',
              to: 'admin@iliqchuan.com',
              from: 'notifications@iliqchuan.com',
              metadata: { adminTest: true },
            }),
          },
        },
        params: { mailId: 'admin_test_bypass' },
      });

      // Document was processed and marked SUCCESS
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'SUCCESS',
        }),
      );
    });
  });

  describe('setMailSendingPaused', () => {
    it('throws error if user is not an admin', async () => {
      vi.spyOn(common, 'assertAdmin').mockRejectedValue(
        new HttpsError('permission-denied', 'Admin access required.'),
      );

      await expect(
        setMailSendingPaused.run({
          auth: { token: { email: 'user@example.com' } },
          data: { paused: true },
        } as any),
      ).rejects.toThrow('Admin access required.');
    });

    it('pauses mail sending and updates /system/mail-settings', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockSet = vi.fn().mockResolvedValue({});
      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return { set: mockSet };
          }
          return {};
        }),
      } as any);

      const result = await setMailSendingPaused.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: { paused: true },
      } as any);

      expect(result.success).toBe(true);
      expect(result.paused).toBe(true);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          sendingPaused: true,
          pausedBy: 'admin@iliqchuan.com',
        }),
        { merge: true },
      );
    });

    it('resumes mail sending and transitions PAUSED documents to PENDING', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockSet = vi.fn().mockResolvedValue({});
      const mockDocUpdate = vi.fn();
      const mockBatchUpdate = vi.fn();
      const mockBatchCommit = vi.fn().mockResolvedValue({});

      const mockBatch = {
        update: mockBatchUpdate,
        commit: mockBatchCommit,
      };

      const pausedDoc1 = { ref: { id: 'doc1' } };
      const pausedDoc2 = { ref: { id: 'doc2' } };

      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return { set: mockSet };
          }
          return {};
        }),
        collection: vi.fn().mockImplementation((coll: string) => {
          if (coll === 'mail') {
            return {
              where: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [pausedDoc1, pausedDoc2],
                }),
              }),
            };
          }
          return {};
        }),
        batch: vi.fn().mockReturnValue(mockBatch),
      } as any);

      const result = await setMailSendingPaused.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: { paused: false },
      } as any);

      expect(result.success).toBe(true);
      expect(result.paused).toBe(false);
      expect(result.resumedCount).toBe(2);
      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });

  describe('setMailSendingState', () => {
    it('throws error if user is not an admin', async () => {
      vi.spyOn(common, 'assertAdmin').mockRejectedValue(
        new HttpsError('permission-denied', 'Admin access required.'),
      );

      await expect(
        setMailSendingState.run({
          auth: { token: { email: 'user@example.com' } },
          data: { status: MailSendingStatus.Active },
        } as any),
      ).rejects.toThrow('Admin access required.');
    });

    it('rejects invalid status parameter', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);

      await expect(
        setMailSendingState.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { status: 'invalid-status' },
        } as any),
      ).rejects.toThrow('Invalid status parameter');
    });

    it('sets status to OFF and updates /system/mail-settings', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockSet = vi.fn().mockResolvedValue({});
      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return { set: mockSet };
          }
          return {};
        }),
      } as any);

      const result = await setMailSendingState.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: { status: MailSendingStatus.Off },
      } as any);

      expect(result.success).toBe(true);
      expect(result.status).toBe(MailSendingStatus.Off);
      expect(result.resumedCount).toBe(0);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MailSendingStatus.Off,
          sendingPaused: false,
          updatedBy: 'admin@iliqchuan.com',
        }),
        { merge: true },
      );
    });

    it('sets status to PAUSED and updates /system/mail-settings', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockSet = vi.fn().mockResolvedValue({});
      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return { set: mockSet };
          }
          return {};
        }),
      } as any);

      const result = await setMailSendingState.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: { status: MailSendingStatus.Paused },
      } as any);

      expect(result.success).toBe(true);
      expect(result.status).toBe(MailSendingStatus.Paused);
      expect(result.resumedCount).toBe(0);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MailSendingStatus.Paused,
          sendingPaused: true,
          pausedBy: 'admin@iliqchuan.com',
        }),
        { merge: true },
      );
    });

    it('sets status to ACTIVE and resumes PAUSED documents to PENDING', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockSet = vi.fn().mockResolvedValue({});
      const mockBatchUpdate = vi.fn();
      const mockBatchCommit = vi.fn().mockResolvedValue({});

      const mockBatch = {
        update: mockBatchUpdate,
        commit: mockBatchCommit,
      };

      const pausedDoc1 = { ref: { id: 'doc1' } };

      vi.spyOn(admin, 'firestore').mockReturnValue({
        doc: vi.fn().mockImplementation((path: string) => {
          if (path === 'system/mail-settings') {
            return { set: mockSet };
          }
          return {};
        }),
        collection: vi.fn().mockImplementation((coll: string) => {
          if (coll === 'mail') {
            return {
              where: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({
                  empty: false,
                  docs: [pausedDoc1],
                }),
              }),
            };
          }
          return {};
        }),
        batch: vi.fn().mockReturnValue(mockBatch),
      } as any);

      const result = await setMailSendingState.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: { status: MailSendingStatus.Active },
      } as any);

      expect(result.success).toBe(true);
      expect(result.status).toBe(MailSendingStatus.Active);
      expect(result.resumedCount).toBe(1);
      expect(mockBatchUpdate).toHaveBeenCalledWith(
        pausedDoc1.ref,
        expect.objectContaining({
          status: 'PENDING',
          'delivery.state': 'PENDING',
        }),
      );
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });

  describe('deleteMailItems', () => {
    it('rejects non-admin callers', async () => {
      vi.spyOn(common, 'assertAdmin').mockRejectedValue(
        new HttpsError('permission-denied', 'Admin access required.'),
      );

      await expect(
        deleteMailItems.run({
          auth: { token: { email: 'user@example.com' } },
          data: { mailIds: ['m1', 'm2'] },
        } as any),
      ).rejects.toThrow('Admin access required.');
    });

    it('validates mailIds input', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);

      await expect(
        deleteMailItems.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailIds: [] },
        } as any),
      ).rejects.toThrow('An array of "mailIds" is required.');

      await expect(
        deleteMailItems.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailIds: ['   '] },
        } as any),
      ).rejects.toThrow('No valid mail IDs provided.');

      const excessiveIds = Array.from({ length: 501 }, (_, i) => `id_${i}`);
      await expect(
        deleteMailItems.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailIds: excessiveIds },
        } as any),
      ).rejects.toThrow('Cannot delete more than 500 mail items at once.');
    });

    it('skips items in PROCESSING and deletes others via Firestore batch', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);

      const mockBatchDelete = vi.fn();
      const mockBatchCommit = vi.fn().mockResolvedValue([]);
      const mockBatch = {
        delete: mockBatchDelete,
        commit: mockBatchCommit,
      };

      const snapDoc1 = {
        id: 'doc1',
        exists: true,
        ref: { id: 'doc1' },
        data: () => ({ status: 'ERROR' }),
      };
      const snapDoc2 = {
        id: 'doc2',
        exists: true,
        ref: { id: 'doc2' },
        data: () => ({ status: 'PROCESSING' }),
      };
      const snapDoc3 = {
        id: 'doc3',
        exists: false,
        ref: { id: 'doc3' },
        data: () => undefined,
      };

      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockImplementation((id: string) => ({ id })),
        }),
        getAll: vi.fn().mockResolvedValue([snapDoc1, snapDoc2, snapDoc3]),
        batch: vi.fn().mockReturnValue(mockBatch),
      } as any);

      const res = await deleteMailItems.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: { mailIds: ['doc1', 'doc2', 'doc3'] },
      } as any);

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(1);
      expect(res.skippedCount).toBe(1);
      expect(res.skippedProcessingIds).toEqual(['doc2']);
      expect(mockBatchDelete).toHaveBeenCalledWith(snapDoc1.ref);
      expect(mockBatchDelete).not.toHaveBeenCalledWith(snapDoc2.ref);
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });

  describe('updateMailItem', () => {
    it('rejects non-admin callers', async () => {
      vi.spyOn(common, 'assertAdmin').mockRejectedValue(
        new HttpsError('permission-denied', 'Admin access required.'),
      );

      await expect(
        updateMailItem.run({
          auth: { token: { email: 'user@example.com' } },
          data: { mailId: 'doc1', subject: 'New Subject' },
        } as any),
      ).rejects.toThrow('Admin access required.');
    });

    it('throws not-found when document does not exist', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: false }),
          }),
        }),
      } as any);

      await expect(
        updateMailItem.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailId: 'nonexistent' },
        } as any),
      ).rejects.toThrow('Mail document "nonexistent" not found.');
    });

    it('throws failed-precondition if mail is currently PROCESSING', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ status: 'PROCESSING' }),
            }),
          }),
        }),
      } as any);

      await expect(
        updateMailItem.run({
          auth: { token: { email: 'admin@iliqchuan.com' } },
          data: { mailId: 'in_flight' },
        } as any),
      ).rejects.toThrow('currently being processed and cannot be edited');
    });

    it('updates recipient, subject, text, markdown-rendered html, templateData, and status', async () => {
      vi.spyOn(common, 'assertAdmin').mockResolvedValue({} as any);
      const mockUpdate = vi.fn().mockResolvedValue({});
      vi.spyOn(admin, 'firestore').mockReturnValue({
        collection: vi.fn().mockReturnValue({
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ status: 'ERROR', delivery: { state: 'ERROR', error: 'Fail' } }),
            }),
            update: mockUpdate,
          }),
        }),
      } as any);

      const res = await updateMailItem.run({
        auth: { token: { email: 'admin@iliqchuan.com' } },
        data: {
          mailId: 'mail_edit_1',
          to: 'fixed@example.com',
          subject: 'Corrected Subject',
          text: 'Hello **World**',
          status: 'PENDING',
          templateData: { key: 'value' },
        },
      } as any);

      expect(res.success).toBe(true);
      expect(res.docId).toBe('mail_edit_1');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'fixed@example.com',
          subject: 'Corrected Subject',
          'message.subject': 'Corrected Subject',
          text: 'Hello **World**',
          'message.text': 'Hello **World**',
          html: expect.stringContaining('<strong>World</strong>'),
          'message.html': expect.stringContaining('<strong>World</strong>'),
          templateData: { key: 'value' },
          status: 'PENDING',
          'delivery.state': 'PENDING',
          'delivery.error': null,
          'metadata.lastEditedBy': 'admin@iliqchuan.com',
        }),
      );
    });
  });
});



