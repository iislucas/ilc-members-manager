import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { writeBatch, getDocs, getDoc, where } from 'firebase/firestore';
import { NotificationService } from './notification.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from './firebase-state.service';
import { MemberNotification, NotificationKind, OrderKind, OrderStatus } from '../../functions/src/data-model';

// Partial-mock firebase/firestore so reconciliation's writes/reads can be
// captured. getFirestore (used in the service constructor) keeps its real
// implementation; the query-builder fns are inert stand-ins since the tests
// drive getDocs' return value directly.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    writeBatch: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    query: vi.fn((...a: unknown[]) => a),
    collection: vi.fn((...a: unknown[]) => ({ __collection: a })),
    collectionGroup: vi.fn((...a: unknown[]) => ({ __collectionGroup: a })),
    doc: vi.fn((...a: unknown[]) => ({ id: 'mock-doc-id', __doc: a })),
    where: vi.fn((...a: unknown[]) => ({ __where: a })),
    limit: vi.fn((...a: unknown[]) => ({ __limit: a })),
  };
});

describe('NotificationService', () => {
  let service: NotificationService;
  let mockFirebaseService: FirebaseStateService;

  beforeEach(() => {
    mockFirebaseService = createFirebaseStateServiceMock();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockFirebaseService },
        NotificationService,
      ],
    });

    service = TestBed.inject(NotificationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should correctly strip markdown for notification push alerts', () => {
    const rawMd = '# Hello *World*!\n\nThis is a [link](https://test.com) and some `code`.';
    const stripped = (service as any).stripMarkdown(rawMd);
    expect(stripped).toBe('Hello World! This is a link and some code.');
  });

  it('should filter unpushed notifications correctly based on localStorage and settings', () => {
    const active: MemberNotification[] = [
      {
        docId: 'id1',
        markdown: 'Update 1',
        createdAt: '2026-05-14T12:00:00Z',
        dismissed: false,
        kind: NotificationKind.GradingRequestAccepted,
        data: {
          gradingDocId: 'grading-1',
          level: 'Student 1',
        },
      },
      {
        docId: 'id2',
        markdown: 'Update 2',
        createdAt: '2026-05-14T12:05:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPost,
        data: {
          blogPath: '/members-post',
          blogCategory: 'members',
          lastSeenDateStr: '2026-05-14T12:05:00Z',
        },
      },
    ];

    // Mock local storage to only contain 'id1' (so 'id2' is unpushed)
    const store: Record<string, string> = {
      pushedNotificationDocIds: JSON.stringify(['id1']),
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store[key] || null);

    // Mock member settings to have BlogPost enabled
    const user = {
      member: {
        docId: 'student1',
        notificationSettings: {
          pushEnabled: {
            [NotificationKind.BlogPost]: true,
          },
          homeEnabled: {},
        },
      },
    } as any;
    vi.spyOn(mockFirebaseService, 'user').mockReturnValue(user);

    const spyLocalStorageSet = vi.spyOn(Storage.prototype, 'setItem');

    // Call private processPushNotifications
    // Mock the browser Notification global constructor to avoid launching real browser notifications in test env
    const mockNotificationConstructor = vi.fn();
    vi.stubGlobal('Notification', mockNotificationConstructor);
    (Notification as any).permission = 'granted';

    (service as any).processPushNotifications(active);

    // Should push a notification for id2 and update localStorage
    expect(mockNotificationConstructor).toHaveBeenCalledWith('New Member Notification', {
      body: 'Update 2',
      icon: '/iliqchuan.png',
    });
    expect(spyLocalStorageSet).toHaveBeenCalledWith('pushedNotificationDocIds', JSON.stringify(['id1', 'id2']));

    vi.unstubAllGlobals();
  });

  describe('reconcileNotifications', () => {
    // Builds a fake Firestore query-doc snapshot the helper can consume: it reads
    // `.id`/`.data()` (via firestoreDocToMemberNotification) and `.ref` (for the
    // batch update).
    const makeDoc = (n: MemberNotification) => ({
      id: n.docId,
      ref: { id: n.docId },
      data: () => n,
    });

    const notif = (over: Partial<MemberNotification>): MemberNotification => ({
      docId: 'x',
      markdown: 'old',
      createdAt: '2026-05-14T12:00:00Z',
      dismissed: false,
      kind: NotificationKind.OrderNeedsAttention,
      data: { orderDocId: 'o-x', orderRef: 'X', status: 'error', issues: [] },
      ...over,
    } as MemberNotification);

    it('rewrites + dismisses resolved, updates changed in place, and skips unchanged', async () => {
      const updates: { ref: { id: string }; patch: Record<string, unknown> }[] = [];
      const commit = vi.fn().mockResolvedValue(undefined);
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        update: (ref: { id: string }, patch: Record<string, unknown>) =>
          updates.push({ ref, patch }),
        commit,
      });

      const resolved = notif({ docId: 'resolved', markdown: 'old', data: { orderDocId: 'o1' } as any });
      const changed = notif({ docId: 'changed', markdown: 'old', data: { orderDocId: 'o2' } as any });
      const unchanged = notif({ docId: 'unchanged', markdown: 'same', data: { orderDocId: 'o3' } as any });
      const dismissed = notif({ docId: 'dismissed', markdown: 'old', dismissed: true, data: { orderDocId: 'o4' } as any });
      const noEntity = notif({ docId: 'no-entity', markdown: 'old', data: {} as any });

      await (service as any).reconcileNotifications(
        [resolved, changed, unchanged, dismissed, noEntity].map(makeDoc),
        'orderDocId',
        async (n: MemberNotification) => {
          switch (n.docId) {
            case 'resolved':
              return { markdown: 'now resolved', data: n.data, resolved: true };
            case 'changed':
              return { markdown: 'new text', data: n.data, resolved: false };
            case 'unchanged':
              return { markdown: n.markdown, data: n.data, resolved: false };
            case 'dismissed':
              return { markdown: 'new text', data: n.data, resolved: false };
            default:
              return null;
          }
        },
      );

      const byId = (id: string) => updates.find((u) => u.ref.id === id)?.patch;

      // resolved: markdown rewritten AND dismissed set.
      expect(byId('resolved')).toEqual({ markdown: 'now resolved', dismissed: true });
      // changed but live: markdown only, dismissed untouched.
      expect(byId('changed')).toEqual({ markdown: 'new text' });
      // unchanged: no write.
      expect(byId('unchanged')).toBeUndefined();
      // already-dismissed + still live: updated in place, NOT re-surfaced.
      expect(byId('dismissed')).toEqual({ markdown: 'new text' });
      // no entity id / null resolve: skipped.
      expect(byId('no-entity')).toBeUndefined();

      expect(commit).toHaveBeenCalledTimes(1);
    });

    it('patches kind to ManualOrderFulfilled and updates markdown when a manual order is fulfilled', async () => {
      const updates: { ref: { id: string }; patch: Record<string, unknown> }[] = [];
      const commit = vi.fn().mockResolvedValue(undefined);
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        update: (ref: { id: string }, patch: Record<string, unknown>) =>
          updates.push({ ref, patch }),
        commit,
      });

      const manualOrderNotif = notif({
        docId: 'notif1',
        kind: NotificationKind.OrderNeedsAttention,
        markdown: 'Order [#1234](/order-view/o1) (from Jane Doe for Annual Membership) needs manual processing',
        data: {
          orderDocId: 'o1',
          orderRef: '1234',
          status: 'needs-manual-processing',
          issues: [],
        } as any,
      });

      const order = {
        docId: 'o1',
        ilcAppOrderKind: OrderKind.Squarespace,
        orderNumber: '1234',
        ilcAppOrderStatus: 'processed',
        fulfillmentStatus: 'FULFILLED',
        billingAddress: { firstName: 'Jane', lastName: 'Doe' },
        lineItems: [{ productName: 'Annual Membership' }],
      };

      await (service as any).reconcileNotifications(
        [manualOrderNotif].map(makeDoc),
        'orderDocId',
        async (_n: MemberNotification) => ({
          markdown: (service as any).manualOrderFulfilledMarkdown(order),
          data: {
            ...(service as any).orderIssueFields(order).data,
            status: 'processed',
            issues: [],
          },
          resolved: false,
          kind: NotificationKind.ManualOrderFulfilled,
        }),
      );

      expect(updates).toHaveLength(1);
      expect(updates[0].patch).toEqual({
        kind: NotificationKind.ManualOrderFulfilled,
        markdown: 'Order [#1234](/order-view/o1) (from Jane Doe for Annual Membership) — manual order was fulfilled',
        data: {
          orderDocId: 'o1',
          orderRef: '1234',
          status: 'processed',
          issues: [],
        },
      });
      expect(updates[0].patch['dismissed']).toBeUndefined();
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it('blog reconcile looks the post up by its source `id` field and refreshes the title', async () => {
      // Regression: posts are keyed in Firestore by an auto-generated doc ID, not
      // by their source `id`, so the lookup must query the `id` field (not getDoc
      // by document ID) or it never finds the post and the title never updates.
      (getDocs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        empty: false,
        docs: [
          {
            data: () => ({
              id: 'src-123',
              title: 'New Title',
              urlId: 'new-title',
              publishOn: 1700000000000,
            }),
          },
        ],
      });

      const feed = { collection: 'members-post', label: 'Members', route: 'members-area/post' };
      const notif: MemberNotification = {
        docId: 'n1',
        markdown: 'New Members post: [Old Title](#/members-area/post/old-title)',
        createdAt: '2026-05-14T12:00:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPost,
        data: {
          blogPath: 'members-post',
          blogCategory: '',
          lastSeenDateStr: '2026-05-14T12:00:00Z',
          blogPostId: 'src-123',
          blogPostUrlId: 'old-title',
        },
      };

      const result = await (service as any).resolveBlogNotification(feed, notif);

      // Looked up by the source id field, not the document id.
      expect(where).toHaveBeenCalledWith('id', '==', 'src-123');
      expect(result.resolved).toBe(false);
      expect(result.markdown).toBe(
        'New Members post: [New Title](/members-area/post/new-title)',
      );
    });

    it('blog reconcile marks a missing post as removed + resolved', async () => {
      (getDocs as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        empty: true,
        docs: [],
      });

      const feed = { collection: 'members-post', label: 'Members', route: 'members-area/post' };
      const notif: MemberNotification = {
        docId: 'n1',
        markdown: 'New Members post: [Old Title](#/members-area/post/old-title)',
        createdAt: '2026-05-14T12:00:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPost,
        data: {
          blogPath: 'members-post',
          blogCategory: '',
          lastSeenDateStr: '2026-05-14T12:00:00Z',
          blogPostId: 'src-404',
          blogPostUrlId: 'old-title',
        },
      };

      const result = await (service as any).resolveBlogNotification(feed, notif);
      expect(result.resolved).toBe(true);
      expect(result.markdown).toBe('~~New Members post~~ (post removed)');
    });

    it('syncBlogFeedNotifications reconciles existing posts even when no NEW posts exist', async () => {
      // Regression: reconciliation used to sit after the create pass's "no new
      // posts" early-return, so a re-titled post (which produces no new post) was
      // never reconciled. This drives the per-feed sync with an empty posts query
      // and asserts the existing notification still gets its title refreshed.
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();

      const existingNotif: MemberNotification = {
        docId: 'n1',
        markdown: 'New Members post: [Old Title](#/members-area/post/old-title)',
        createdAt: '2026-05-14T12:00:00Z',
        dismissed: false,
        kind: NotificationKind.BlogPost,
        data: {
          blogPath: 'members-post',
          blogCategory: '',
          lastSeenDateStr: '2026-05-14T12:00:00Z',
          blogPostId: 'src-123',
          blogPostUrlId: 'old-title',
        },
      };
      const existingDoc = { id: 'n1', ref: { id: 'n1' }, data: () => existingNotif };
      const existingSnap = {
        forEach: (cb: (d: unknown) => void) => [existingDoc].forEach(cb),
        docs: [existingDoc],
      };

      getDocsMock
        // 1) existing BlogPost notifications for this member
        .mockResolvedValueOnce(existingSnap)
        // 2) latest posts query — empty: nothing new published since the cut-off
        .mockResolvedValueOnce({ empty: true, docs: [] })
        // 3) reconcile lookup of the post by its source `id` — returns new title
        .mockResolvedValueOnce({
          empty: false,
          docs: [
            {
              data: () => ({
                id: 'src-123',
                title: 'New Title',
                urlId: 'new-title',
                publishOn: 1700000000000,
              }),
            },
          ],
        });

      const updates: { patch: Record<string, unknown> }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: vi.fn(),
        update: (_ref: unknown, patch: Record<string, unknown>) => updates.push({ patch }),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      const feed = { collection: 'members-post', label: 'Members', route: 'members-area/post' };
      await (service as any).syncBlogFeedNotifications('member1', feed);

      expect(updates).toHaveLength(1);
      expect(updates[0].patch['markdown']).toBe(
        'New Members post: [New Title](/members-area/post/new-title)',
      );
    });

    it('does not commit when nothing changed (idempotent re-run)', async () => {
      const commit = vi.fn().mockResolvedValue(undefined);
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        update: vi.fn(),
        commit,
      });

      const n = notif({ docId: 'a', markdown: 'same', data: { orderDocId: 'o1' } as any });
      await (service as any).reconcileNotifications([makeDoc(n)], 'orderDocId', async () => ({
        markdown: 'same',
        data: n.data,
        resolved: false,
      }));

      expect(commit).not.toHaveBeenCalled();
    });
  });

  describe('orderIssueFields', () => {
    const fields = (order: unknown) => (service as any).orderIssueFields(order);

    it('includes who placed a Squarespace order and what it was for', () => {
      const order = {
        docId: 'o1',
        ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
        ilcAppOrderStatus: 'needs-manual-processing',
        orderNumber: '1234',
        customerEmail: 'jane@example.com',
        billingAddress: { firstName: 'Jane', lastName: 'Doe' },
        lineItems: [{ productName: 'Annual Membership' }, { productName: 'Video Library' }],
      };
      expect(fields(order).markdown).toBe(
        'Order [#1234](/order-view/o1) (from Jane Doe for Annual Membership, Video Library) needs manual processing',
      );
    });

    it('uses customerName/description for Stripe orders and appends issues', () => {
      const order = {
        docId: 'o2',
        ilcAppOrderKind: 'stripe',
        ilcAppOrderStatus: 'error',
        stripeObjectId: 'cs_123',
        customerName: 'John Smith',
        lineItems: [{ description: 'Grading Fee' }],
        ilcAppOrderIssues: ['no matching member'],
      };
      expect(fields(order).markdown).toBe(
        'Order [#cs_123](/order-view/o2) (from John Smith for Grading Fee) failed with an error — no matching member',
      );
    });

    it('shows a sensible summary for a physical-product order, using SKU as fallback', () => {
      const order = {
        docId: 'o4',
        ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
        ilcAppOrderStatus: 'needs-manual-processing',
        orderNumber: '5678',
        billingAddress: { firstName: 'Sam', lastName: 'Lee' },
        // A physical book (as displayed "1x BOOK : System Guide - 3rd Edition")
        // plus a second item that only carries a SKU.
        lineItems: [
          { productName: 'BOOK : System Guide - 3rd Edition', sku: 'PRINT-3SGUIDE' },
          { sku: 'PRINT-POSTER' },
        ],
      };
      expect(fields(order).markdown).toBe(
        'Order [#5678](/order-view/o4) (from Sam Lee for BOOK : System Guide - 3rd Edition, PRINT-POSTER) needs manual processing',
      );
    });

    it('falls back to email and omits the details clause when nothing is known', () => {
      const order = {
        docId: 'o3',
        ilcAppOrderKind: 'stripe',
        ilcAppOrderStatus: 'error',
        stripeObjectId: 'cs_9',
        lineItems: [],
      };
      expect(fields(order).markdown).toBe(
        'Order [#cs_9](/order-view/o3) failed with an error',
      );
    });
  });

  describe('manualOrderFulfilledMarkdown', () => {
    const md = (order: unknown) => (service as any).manualOrderFulfilledMarkdown(order);

    it('includes who placed a Squarespace order and what it was for with fulfilled phrasing', () => {
      const order = {
        docId: 'o1',
        ilcAppOrderKind: 'https://api.squarespace.com/1.0/commerce/orders',
        ilcAppOrderStatus: 'processed',
        fulfillmentStatus: 'FULFILLED',
        orderNumber: '1234',
        customerEmail: 'jane@example.com',
        billingAddress: { firstName: 'Jane', lastName: 'Doe' },
        lineItems: [{ productName: 'Annual Membership' }, { productName: 'Video Library' }],
      };
      expect(md(order)).toBe(
        'Order [#1234](/order-view/o1) (from Jane Doe for Annual Membership, Video Library) — manual order was fulfilled',
      );
    });

    it('falls back to order doc ID when no details known', () => {
      const order = {
        docId: 'o3',
        ilcAppOrderKind: 'stripe',
        ilcAppOrderStatus: 'processed',
        stripeObjectId: 'cs_9',
        lineItems: [],
      };
      expect(md(order)).toBe(
        'Order [#cs_9](/order-view/o3) — manual order was fulfilled',
      );
    });
  });

  describe('upload notifications', () => {
    const uploadFields = (upload: unknown) => (service as any).uploadNotificationFields(upload);
    const dateRangeDisplay = (x: string, y: string) => (service as any).formatDateRangeDisplay(x, y);

    it('generates markdown with uploader, link, event, and location for uploadNotificationFields', () => {
      const upload = {
        docId: 'up1',
        memberDocId: 'mem1',
        name: 'Lesson 1.mp4',
        memberName: 'Master Sam Chin',
        memberId: '1',
        eventDocId: 'ev1',
        eventTitle: 'Autumn Intensive',
        location: 'San Jose',
        createdAt: '2026-08-11T12:00:00Z',
      };
      const result = uploadFields(upload);
      expect(result.markdown).toBe(
        'New upload from **Master Sam Chin (1)**: [Lesson 1.mp4](/manage-materials?q=Lesson%201.mp4) for **Autumn Intensive** in San Jose',
      );
      expect(result.data.uploadDocId).toBe('up1');
      expect(result.data.memberDocId).toBe('mem1');
    });

    it('formats date range display correctly for same date and different dates', () => {
      expect(dateRangeDisplay('2026-08-11T10:00:00Z', '2026-08-11T18:00:00Z')).toBe('on 2026-08-11');
      expect(dateRangeDisplay('2026-08-01T10:00:00Z', '2026-08-05T18:00:00Z')).toBe('between 2026-08-01 and 2026-08-05');
    });

    it('creates individual notifications when new uploads count <= 3', async () => {
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();

      // 1) existing upload notifications: empty (no prior notifications)
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      // 2) collection group query on uploads: returns 3 uploads
      const uploads = [
        {
          docId: 'up3',
          memberDocId: 'mem1',
          name: 'Video3.mp4',
          memberName: 'Alice',
          createdAt: '2026-08-11T15:00:00Z',
        },
        {
          docId: 'up2',
          memberDocId: 'mem1',
          name: 'Video2.mp4',
          memberName: 'Alice',
          createdAt: '2026-08-11T14:00:00Z',
        },
        {
          docId: 'up1',
          memberDocId: 'mem2',
          name: 'Video1.mp4',
          memberName: 'Bob',
          createdAt: '2026-08-11T13:00:00Z',
        },
      ];

      getDocsMock.mockResolvedValueOnce({
        docs: uploads.map((u) => ({ id: u.docId, data: () => u })),
      });

      const writes: { notif: MemberNotification }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: (_ref: unknown, notif: MemberNotification) => writes.push({ notif }),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      const member = { docId: 'admin1', isAdmin: true } as any;
      await (service as any).syncNewUploadNotifications(member);

      expect(writes).toHaveLength(3);
      expect(writes[0].notif.kind).toBe(NotificationKind.NewUpload);
      expect(writes[0].notif.markdown).toContain('Video3.mp4');
      expect(writes[1].notif.kind).toBe(NotificationKind.NewUpload);
      expect(writes[2].notif.kind).toBe(NotificationKind.NewUpload);
    });

    it('creates 3 individual notifications and 1 summary notification when new uploads count > 3', async () => {
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();

      // 1) existing upload notifications: empty
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      // 2) collection group query on uploads: returns 7 uploads
      const uploads = [
        { docId: 'up7', memberDocId: 'm1', name: 'V7.mp4', memberName: 'User', createdAt: '2026-08-07T12:00:00Z' },
        { docId: 'up6', memberDocId: 'm1', name: 'V6.mp4', memberName: 'User', createdAt: '2026-08-06T12:00:00Z' },
        { docId: 'up5', memberDocId: 'm1', name: 'V5.mp4', memberName: 'User', createdAt: '2026-08-05T12:00:00Z' },
        { docId: 'up4', memberDocId: 'm1', name: 'V4.mp4', memberName: 'User', createdAt: '2026-08-04T12:00:00Z' },
        { docId: 'up3', memberDocId: 'm1', name: 'V3.mp4', memberName: 'User', createdAt: '2026-08-03T12:00:00Z' },
        { docId: 'up2', memberDocId: 'm1', name: 'V2.mp4', memberName: 'User', createdAt: '2026-08-02T12:00:00Z' },
        { docId: 'up1', memberDocId: 'm1', name: 'V1.mp4', memberName: 'User', createdAt: '2026-08-01T12:00:00Z' },
      ];

      getDocsMock.mockResolvedValueOnce({
        docs: uploads.map((u) => ({ id: u.docId, data: () => u })),
      });

      const writes: { notif: MemberNotification }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: (_ref: unknown, notif: MemberNotification) => writes.push({ notif }),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      const member = { docId: 'admin2', isAdmin: true } as any;
      await (service as any).syncNewUploadNotifications(member);

      // 3 individual + 1 summary = 4 notifications
      expect(writes).toHaveLength(4);

      const individuals = writes.filter((w) => w.notif.kind === NotificationKind.NewUpload);
      const summaries = writes.filter((w) => w.notif.kind === NotificationKind.NewUploadsSummary);

      expect(individuals).toHaveLength(3);
      expect(summaries).toHaveLength(1);

      const summary = summaries[0].notif;
      expect(summary.markdown).toContain('**4** more uploads between 2026-08-01 and 2026-08-04');
      expect(summary.markdown).toContain('/manage-materials?startDate=2026-08-01&endDate=2026-08-04');
      expect((summary.data as any).count).toBe(4);
      expect((summary.data as any).startDate).toBe('2026-08-01');
      expect((summary.data as any).endDate).toBe('2026-08-04');
    });

    it('ignores uploads where memberDocId equals the admin member docId', async () => {
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();

      // 1) existing upload notifications: empty
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      // 2) collection group query on uploads: includes 1 self upload and 1 other upload
      const uploads = [
        { docId: 'up-self', memberDocId: 'admin1', name: 'MyVid.mp4', memberName: 'Admin', createdAt: '2026-08-11T12:00:00Z' },
        { docId: 'up-other', memberDocId: 'other-mem', name: 'OtherVid.mp4', memberName: 'Other', createdAt: '2026-08-11T11:00:00Z' },
      ];

      getDocsMock.mockResolvedValueOnce({
        docs: uploads.map((u) => ({ id: u.docId, data: () => u })),
      });

      const writes: { notif: MemberNotification }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: (_ref: unknown, notif: MemberNotification) => writes.push({ notif }),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      const member = { docId: 'admin1', isAdmin: true } as any;
      await (service as any).syncNewUploadNotifications(member);

      expect(writes).toHaveLength(1);
      expect((writes[0].notif.data as { uploadDocId?: string })?.uploadDocId).toBe('up-other');
    });
  });

  describe('blog posts summary notifications', () => {
    it('creates 3 individual notifications and 1 summary notification when new blog posts count > 3', async () => {
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();

      // 1) existing notifications: empty
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      // 2) posts collection query: returns 5 posts
      const posts = [
        { id: 'p5', title: 'Post 5', slug: 'post-5', publishOn: 1700005000000 },
        { id: 'p4', title: 'Post 4', slug: 'post-4', publishOn: 1700004000000 },
        { id: 'p3', title: 'Post 3', slug: 'post-3', publishOn: 1700003000000 },
        { id: 'p2', title: 'Post 2', slug: 'post-2', publishOn: 1700002000000 },
        { id: 'p1', title: 'Post 1', slug: 'post-1', publishOn: 1700001000000 },
      ];

      getDocsMock.mockResolvedValueOnce({
        docs: posts.map((p) => ({ id: p.id, data: () => p })),
      });

      const writes: { notif: MemberNotification }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: (_ref: unknown, notif: MemberNotification) => writes.push({ notif }),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      const feed = { collection: 'members-post', label: 'Members', route: 'members-area/post' };
      await (service as any).syncBlogFeedNotifications('mem1', feed);

      expect(writes).toHaveLength(4);
      const individuals = writes.filter((w) => w.notif.kind === NotificationKind.BlogPost);
      const summaries = writes.filter((w) => w.notif.kind === NotificationKind.BlogPostsSummary);

      expect(individuals).toHaveLength(3);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].notif.markdown).toContain('**2** more Members posts: [View in Members Area](/members-area)');
      expect((summaries[0].notif.data as any).count).toBe(2);
    });
  });

  describe('pending events summary notifications', () => {
    it('creates 3 individual notifications and 1 summary notification when pending events > 3', async () => {
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();

      // 1) existing notifications: empty
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      // 2) events query: returns 5 proposed events
      const events = [
        { docId: 'e5', title: 'Event 5', status: 'proposed', createdAt: '2026-08-05T12:00:00Z' },
        { docId: 'e4', title: 'Event 4', status: 'proposed', createdAt: '2026-08-04T12:00:00Z' },
        { docId: 'e3', title: 'Event 3', status: 'proposed', createdAt: '2026-08-03T12:00:00Z' },
        { docId: 'e2', title: 'Event 2', status: 'proposed', createdAt: '2026-08-02T12:00:00Z' },
        { docId: 'e1', title: 'Event 1', status: 'proposed', createdAt: '2026-08-01T12:00:00Z' },
      ];

      getDocsMock.mockResolvedValueOnce({
        docs: events.map((e) => ({ id: e.docId, data: () => e })),
      });

      const writes: { notif: MemberNotification }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: (_ref: unknown, notif: MemberNotification) => writes.push({ notif }),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      const member = { docId: 'admin1', isAdmin: true } as any;
      await (service as any).syncPendingEventNotifications(member);

      expect(writes).toHaveLength(4);
      const individuals = writes.filter((w) => w.notif.kind === NotificationKind.PendingEventApproval);
      const summaries = writes.filter((w) => w.notif.kind === NotificationKind.PendingEventsSummary);

      expect(individuals).toHaveLength(3);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].notif.markdown).toContain('**2** more proposed events awaiting approval: [View in Manage Events](/manage-events?status=proposed)');
      expect((summaries[0].notif.data as any).count).toBe(2);
    });
  });

  describe('order issues summary notifications', () => {
    it('creates 3 individual notifications and 1 summary notification when order issues > 3', async () => {
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();

      // 1) existing notifications: empty
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      // 2) orders query: returns 5 order issues
      const orders = [
        { docId: 'o5', ilcAppOrderStatus: 'error', lastUpdated: '2026-08-05T12:00:00Z' },
        { docId: 'o4', ilcAppOrderStatus: 'error', lastUpdated: '2026-08-04T12:00:00Z' },
        { docId: 'o3', ilcAppOrderStatus: 'error', lastUpdated: '2026-08-03T12:00:00Z' },
        { docId: 'o2', ilcAppOrderStatus: 'error', lastUpdated: '2026-08-02T12:00:00Z' },
        { docId: 'o1', ilcAppOrderStatus: 'error', lastUpdated: '2026-08-01T12:00:00Z' },
      ];

      getDocsMock.mockResolvedValueOnce({
        docs: orders.map((o) => ({ id: o.docId, data: () => o })),
      });

      const writes: { notif: MemberNotification }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: (_ref: unknown, notif: MemberNotification) => writes.push({ notif }),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      const member = { docId: 'admin1', isAdmin: true } as any;
      await (service as any).syncOrderIssueNotifications(member);

      expect(writes).toHaveLength(4);
      const individuals = writes.filter((w) => w.notif.kind === NotificationKind.OrderNeedsAttention);
      const summaries = writes.filter((w) => w.notif.kind === NotificationKind.OrderIssuesSummary);

      expect(individuals).toHaveLength(3);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].notif.markdown).toContain('**2** more orders need attention: [View in Manage Orders](/orders)');
      expect((summaries[0].notif.data as any).count).toBe(2);
    });
  });

  describe('unpaid gradings summary notifications', () => {
    it('creates 3 individual notifications and 1 summary notification when unpaid gradings > 3', async () => {
      const getDocsMock = getDocs as unknown as ReturnType<typeof vi.fn>;
      const getDocMock = (await import('firebase/firestore')).getDoc as unknown as ReturnType<typeof vi.fn>;
      getDocsMock.mockReset();
      getDocMock.mockReset();

      // 1) existing notifications: empty
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      // Member with 5 gradings
      const member = {
        docId: 'mem_unpaid_1',
        instructorId: 'US100',
        gradingDocIds: ['g1', 'g2', 'g3', 'g4', 'g5'],
      } as any;

      for (let i = 1; i <= 5; i++) {
        getDocMock.mockResolvedValueOnce({
          exists: () => true,
          id: `g${i}`,
          data: () => ({
            docId: `g${i}`,
            level: `Level ${i}`,
            status: 'passed',
            paymentStatus: 'not-yet-paid',
            gradingEventDate: `2026-08-0${i}`,
          }),
        });
      }

      // Instructor mirror query: empty
      getDocsMock.mockResolvedValueOnce({ docs: [], forEach: vi.fn() });

      const writes: { notif: MemberNotification }[] = [];
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        set: (_ref: unknown, notif: MemberNotification) => writes.push({ notif }),
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      });

      await (service as any).syncUnpaidGradingNotifications(member);

      expect(writes).toHaveLength(4);
      const individuals = writes.filter((w) => w.notif.kind === NotificationKind.GradingUnpaid);
      const summaries = writes.filter((w) => w.notif.kind === NotificationKind.UnpaidGradingsSummary);

      expect(individuals).toHaveLength(3);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].notif.markdown).toContain('**2** more unpaid gradings: [View in Gradings](/gradings)');
      expect((summaries[0].notif.data as any).count).toBe(2);
    });
  });

  describe('syncError', () => {
    it('sets and formats sync error with clickable markdown links for URLs', () => {
      service.setSyncError(
        'Failed to sync uploads',
        new Error('Missing index: https://console.firebase.google.com/indexes?create=123 for collection'),
      );
      expect(service.syncError()).toBe(
        'Failed to sync uploads: Missing index: [https://console.firebase.google.com/indexes?create=123](https://console.firebase.google.com/indexes?create=123) for collection',
      );
    });

    it('clears sync error on dismissSyncError', () => {
      service.setSyncError('Failed', new Error('Something broke'));
      expect(service.syncError()).toBeTruthy();
      service.dismissSyncError();
      expect(service.syncError()).toBeNull();
    });
  });

  describe('dismissAllFyi', () => {
    it('dismisses only informational (FYI) notifications', async () => {
      const todoNotif: MemberNotification = {
        docId: 'todo-1',
        markdown: 'A to-do item',
        createdAt: '2026-05-14T12:00:00Z',
        dismissed: false,
        kind: NotificationKind.GradingRequestsYouAsInstructor,
        data: { gradingDocId: 'g-1', studentName: 'S', level: '1' },
      };
      const fyiNotif: MemberNotification = {
        docId: 'fyi-1',
        markdown: 'An info item',
        createdAt: '2026-05-14T12:00:00Z',
        dismissed: false,
        kind: NotificationKind.GradingRequestAccepted,
        data: { gradingDocId: 'g-1', level: '1' },
      };

      service.notifications.set([todoNotif, fyiNotif]);
      const member = { docId: 'mem1' } as any;
      vi.spyOn(mockFirebaseService, 'user').mockReturnValue({ member } as any);

      const updates: { ref: { id: string }; patch: Record<string, unknown> }[] = [];
      const commit = vi.fn().mockResolvedValue(undefined);
      (writeBatch as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        update: (ref: { id: string }, patch: Record<string, unknown>) =>
          updates.push({ ref, patch }),
        commit,
      });

      await service.dismissAllFyi();

      expect(updates).toHaveLength(1);
      expect(updates[0].patch).toEqual({ dismissed: true });
      expect(commit).toHaveBeenCalled();
    });
  });
});
