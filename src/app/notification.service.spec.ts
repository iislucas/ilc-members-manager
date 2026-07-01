import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { writeBatch, getDocs, where } from 'firebase/firestore';
import { NotificationService } from './notification.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from './firebase-state.service';
import { MemberNotification, NotificationKind } from '../../functions/src/data-model';

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
    query: vi.fn((...a: unknown[]) => a),
    collection: vi.fn((...a: unknown[]) => ({ __collection: a })),
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
});
