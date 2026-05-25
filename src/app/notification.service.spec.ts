import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { NotificationService } from './notification.service';
import { FirebaseStateService, createFirebaseStateServiceMock } from './firebase-state.service';
import { MemberNotification, NotificationKind } from '../../functions/src/data-model';

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
});
