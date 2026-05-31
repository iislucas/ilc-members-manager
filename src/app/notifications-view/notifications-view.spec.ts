import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { NotificationsViewComponent } from './notifications-view';
import { MemberNotification, NotificationKind } from '../../../functions/src/data-model';
import { NotificationService } from '../notification.service';
import { RoutingService } from '../routing.service';
import { Views } from '../app.config';

describe('NotificationsViewComponent', () => {
  let component: NotificationsViewComponent;
  let fixture: ComponentFixture<NotificationsViewComponent>;

  let mockNotificationService: any;
  let mockRoutingService: any;
  let filterSignal: any;

  const unreadNotif: MemberNotification = {
    docId: 'id1',
    markdown: 'Welcome Student!',
    createdAt: '2026-05-14T12:00:00Z',
    dismissed: false,
    kind: NotificationKind.GradingRequestAccepted,
    data: { gradingDocId: 'grading-1', level: 'Student 1' },
  };

  const readNotif: MemberNotification = {
    docId: 'id2',
    markdown: 'An old blog post',
    createdAt: '2026-05-10T12:00:00Z',
    dismissed: true,
    kind: NotificationKind.BlogPost,
    data: { blogPath: 'blog', blogCategory: '', lastSeenDateStr: '' },
  };

  beforeEach(async () => {
    filterSignal = signal<string | undefined>(undefined);

    mockNotificationService = {
      allNotifications: signal([unreadNotif, readNotif]),
      subscribeToAllNotifications: vi.fn(),
      unsubscribeFromAllNotifications: vi.fn(),
      dismissNotification: vi.fn().mockResolvedValue(undefined),
      markUnread: vi.fn().mockResolvedValue(undefined),
      deleteNotification: vi.fn().mockResolvedValue(undefined),
      dismissAll: vi.fn().mockResolvedValue(undefined),
    };

    mockRoutingService = {
      hrefForView: vi.fn().mockReturnValue('#/gradings/grading-1'),
      signals: {
        [Views.Notifications]: { urlParams: { filter: filterSignal } },
      },
    };

    await TestBed.configureTestingModule({
      imports: [NotificationsViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsViewComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create and subscribe to all notifications', () => {
    expect(component).toBeTruthy();
    expect(mockNotificationService.subscribeToAllNotifications).toHaveBeenCalled();
  });

  it('should render both read and unread notifications under the "all" filter', () => {
    const cards = fixture.nativeElement.querySelectorAll('.notification-card');
    expect(cards.length).toBe(2);
  });

  it('should show only unread notifications under the "unread" filter', () => {
    filterSignal.set('unread');
    fixture.detectChanges();
    expect(component.visibleNotifications().length).toBe(1);
    expect(component.visibleNotifications()[0].docId).toBe('id1');
  });

  it('should link any notification carrying a gradingDocId, regardless of kind', () => {
    // e.g. an "assigned as grading manager / assistant instructor" notification
    // whose kind is not one of the original grading-request kinds.
    const assignedNotif = {
      docId: 'id3',
      markdown: 'You have been assigned as the grading manager to grade X for Application 1',
      createdAt: '2026-05-12T12:00:00Z',
      dismissed: false,
      kind: 'GradingManagerAssigned',
      data: { gradingDocId: 'grading-9', level: 'Application 1' },
    } as unknown as MemberNotification;

    expect(component.isGradingNotification(assignedNotif)).toBe(true);
    expect(component.gradingHref(assignedNotif)).toBe('#/gradings/grading-1');
    expect(mockRoutingService.hrefForView).toHaveBeenCalledWith(Views.GradingView, {
      gradingId: 'grading-9',
    });
  });

  it('should not link notifications without a gradingDocId', () => {
    expect(component.isGradingNotification(readNotif)).toBe(false);
    expect(component.gradingHref(readNotif)).toBeNull();
  });

  it('should mark an unread notification read', async () => {
    await component.onMarkRead('id1');
    expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith('id1');
  });

  it('should mark a read notification unread', async () => {
    await component.onMarkUnread('id2');
    expect(mockNotificationService.markUnread).toHaveBeenCalledWith('id2');
  });

  it('should require confirmation before deleting', async () => {
    component.requestDelete('id1');
    expect(component.confirmingDeleteId()).toBe('id1');
    expect(mockNotificationService.deleteNotification).not.toHaveBeenCalled();

    await component.confirmDelete('id1');
    expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith('id1');
    expect(component.confirmingDeleteId()).toBeNull();
  });

  it('should unsubscribe on destroy', () => {
    fixture.destroy();
    expect(mockNotificationService.unsubscribeFromAllNotifications).toHaveBeenCalled();
  });
});
