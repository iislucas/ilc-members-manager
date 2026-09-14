import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as admin from 'firebase-admin';
import { processEventDigest } from './event-digest-scheduler';
import { environment } from './environment/environment';
import { MailSendingStatus, MailDeliveryState } from './data-model/mail';
import { EventDigestFrequency } from './data-model/notifications';

describe('processEventDigest', () => {
  let mockDb: any;
  let mockBatch: any;
  let mockBatchSet: any;
  let mockBatchCommit: any;
  let mockEventsQueryGet: any;
  let mockMembersQueryGet: any;
  let mockTemplateDocGet: any;

  beforeEach(() => {
    mockBatchSet = vi.fn();
    mockBatchCommit = vi.fn().mockResolvedValue(undefined);
    mockBatch = {
      set: mockBatchSet,
      commit: mockBatchCommit,
    };

    mockEventsQueryGet = vi.fn();
    mockMembersQueryGet = vi.fn();
    mockTemplateDocGet = vi.fn().mockResolvedValue({
      exists: false,
      data: () => ({}),
    });

    mockDb = {
      batch: vi.fn().mockReturnValue(mockBatch),
      doc: vi.fn().mockImplementation((path: string) => {
        if (path === 'system/mail-settings') {
          return {
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ status: MailSendingStatus.Active }),
            }),
          };
        }
        return {
          get: mockTemplateDocGet,
        };
      }),
      collection: vi.fn((colName: string) => {
        if (colName === 'events') {
          const chain: any = {};
          chain.where = vi.fn().mockReturnValue(chain);
          chain.orderBy = vi.fn().mockReturnValue(chain);
          chain.limit = vi.fn().mockReturnValue(chain);
          chain.get = mockEventsQueryGet;
          return chain;
        }
        if (colName === 'members') {
          return {
            where: vi.fn().mockReturnValue({
              get: mockMembersQueryGet,
            }),
          };
        }
        if (colName === 'mail') {
          return {
            doc: vi.fn().mockReturnValue({ id: 'mail-generated-id' }),
          };
        }
        return {};
      }),
    } as unknown as admin.firestore.Firestore;
  });

  it('compiles 2-tier event digest and enqueues to /mail for opted-in members with events in next 3 months', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'digest@iliqchuan.com';

    const now = new Date();
    const event1Date = new Date(now);
    event1Date.setDate(event1Date.getDate() + 14); // 2 weeks out (within 3 months)
    const event1Str = event1Date.toISOString().split('T')[0];

    const event2Date = new Date(now);
    event2Date.setDate(event2Date.getDate() + 45); // 1.5 months out (within 3 months)
    const event2Str = event2Date.toISOString().split('T')[0];

    const farFutureDate = new Date(now);
    farFutureDate.setMonth(farFutureDate.getMonth() + 5); // 5 months out (beyond 3 months)
    const farFutureStr = farFutureDate.toISOString().split('T')[0];

    const pastDate = new Date(now);
    pastDate.setDate(pastDate.getDate() - 10); // 10 days ago (past)
    const pastStr = pastDate.toISOString().split('T')[0];

    // Mock upcoming events
    mockEventsQueryGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'event-1',
          data: () => ({
            title: 'Pushing Hands Masterclass',
            start: event1Str,
            end: event1Str,
            location: 'New York, NY',
            inPerson: true,
            online: false,
            instructorNames: ['Master Sam Chin'],
            priceDescription: '$200',
            description: 'Learn the principles of neutral point and listening energy.',
          }),
        },
        {
          id: 'event-2',
          data: () => ({
            title: 'Online Spinning Hands Clinic',
            start: event2Str,
            end: event2Str,
            location: '',
            inPerson: false,
            online: true,
            instructorNames: ['Master Joshua Craig'],
            priceDescription: '$50',
            description: 'Interactive online session focusing on circular footwork.',
          }),
        },
        {
          id: 'event-far',
          data: () => ({
            title: 'Far Future Retreat',
            start: farFutureStr,
            end: farFutureStr,
            location: 'Mount Kailash',
            description: 'Should be excluded because it is 5 months away.',
          }),
        },
        {
          id: 'event-past',
          data: () => ({
            title: 'Past Workshop',
            start: pastStr,
            end: pastStr,
            location: 'Old Studio',
            description: 'Should be excluded because it is in the past.',
          }),
        },
      ],
    });

    // Mock opted-in members
    mockMembersQueryGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'member-1',
          data: () => ({
            name: 'Alice Wong',
            emails: ['alice@example.com'],
            notificationSettings: { eventDigestFrequency: 'weekly' },
          }),
        },
        {
          id: 'member-2',
          data: () => ({
            name: 'Bob Miller',
            emails: ['bob@example.com'],
            notificationSettings: { eventDigestFrequency: 'weekly' },
          }),
        },
      ],
    });

    try {
      const enqueuedCount = await processEventDigest(mockDb, EventDigestFrequency.Weekly);

      expect(enqueuedCount).toBe(2);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      expect(mockBatchSet).toHaveBeenCalledTimes(2);

      // Verify first member's email payload
      const firstCallArgs = mockBatchSet.mock.calls[0];
      const mailPayload = firstCallArgs[1];

      expect(mailPayload.to).toEqual(['alice@example.com']);
      expect(mailPayload.from).toBe('digest@iliqchuan.com');
      expect(mailPayload.message.subject).toContain('Upcoming I Liq Chuan Events - the next 3 months');
      // Assert compiled 2-tier content: includes 2 events in window, excludes far future and past
      expect(mailPayload.message.text).toContain('Alice Wong');
      expect(mailPayload.message.text).toContain('Pushing Hands Masterclass');
      expect(mailPayload.message.text).toContain('Online Spinning Hands Clinic');
      expect(mailPayload.message.text).not.toContain('Far Future Retreat');
      expect(mailPayload.message.text).not.toContain('Past Workshop');
      expect(mailPayload.templateData.eventsCount).toBe('2');
      expect(mailPayload.message.html).toContain('<strong><a href="https://app.iliqchuan.com/events/event-1">Pushing Hands Masterclass</a></strong>');
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('skips digest generation if no upcoming events exist', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'digest@iliqchuan.com';

    mockEventsQueryGet.mockResolvedValue({
      empty: true,
      docs: [],
    });

    try {
      const count = await processEventDigest(mockDb, EventDigestFrequency.Weekly, 'this week');
      expect(count).toBe(0);
      expect(mockMembersQueryGet).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('skips digest generation if no members are opted in', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'digest@iliqchuan.com';

    mockEventsQueryGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'evt', data: () => ({ title: 'Event', startDate: '2026-10-01' }) }],
    });

    mockMembersQueryGet.mockResolvedValue({
      empty: true,
      docs: [],
    });

    try {
      const count = await processEventDigest(mockDb, EventDigestFrequency.Monthly, 'this month');
      expect(count).toBe(0);
      expect(mockBatchCommit).not.toHaveBeenCalled();
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('skips digest and returns 0 without querying events or writing to /mail when mail sending is OFF', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'digest@iliqchuan.com';

    mockDb.doc = vi.fn().mockImplementation((path: string) => {
      if (path === 'system/mail-settings') {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ status: MailSendingStatus.Off }),
          }),
        };
      }
      return { get: mockTemplateDocGet };
    });

    try {
      const count = await processEventDigest(mockDb, EventDigestFrequency.Weekly, 'this week');
      expect(count).toBe(0);
      expect(mockEventsQueryGet).not.toHaveBeenCalled();
      expect(mockBatchCommit).not.toHaveBeenCalled();
    } finally {
      environment.email.from = originalFrom;
    }
  });

  it('enqueues placeholder documents with status PAUSED when mail sending is PAUSED', async () => {
    const originalFrom = environment.email.from;
    environment.email.from = 'digest@iliqchuan.com';

    mockDb.doc = vi.fn().mockImplementation((path: string) => {
      if (path === 'system/mail-settings') {
        return {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ status: MailSendingStatus.Paused }),
          }),
        };
      }
      return { get: mockTemplateDocGet };
    });

    mockEventsQueryGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'evt_1',
          data: () => ({
            title: 'Workshop',
            startDate: '2026-10-01',
            status: 'listed',
          }),
        },
      ],
    });

    mockMembersQueryGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'mem_1',
          data: () => ({
            name: 'Paused Student',
            emails: ['student@example.com'],
          }),
        },
      ],
    });

    try {
      const count = await processEventDigest(mockDb, EventDigestFrequency.Weekly, 'this week');
      expect(count).toBe(1);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: MailDeliveryState.Paused,
          to: ['student@example.com'],
          templateKey: 'eventDigestOverall',
          delivery: expect.objectContaining({
            state: MailDeliveryState.Paused,
          }),
          message: expect.objectContaining({
            subject: expect.stringContaining('[Queued / Paused]'),
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
