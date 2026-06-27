import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { NotificationsListComponent } from './notifications-list';
import { MemberNotification, NotificationKind } from '../../../functions/src/data-model';
import { FirebaseStateService } from '../firebase-state.service';
import { NotificationService } from '../notification.service';
import { RoutingService } from '../routing.service';

describe('NotificationsListComponent', () => {
  let component: NotificationsListComponent;
  let fixture: ComponentFixture<NotificationsListComponent>;

  // Mocks
  let mockFirebaseService: any;
  let mockNotificationService: any;
  let mockRoutingService: any;

  const mockNotif: MemberNotification = {
    docId: 'id1',
    markdown: 'Welcome Student!',
    createdAt: '2026-05-14T12:00:00Z',
    dismissed: false,
    kind: NotificationKind.GradingRequestAccepted,
    data: {
      gradingDocId: 'grading-1',
      level: 'Student 1',
    },
  };

  beforeEach(async () => {
    mockFirebaseService = {
      user: signal({
        email: 'student@example.com',
        member: {
          name: 'Student Name',
          notificationSettings: {
            homeEnabled: {},
          },
        },
      }),
    };

    mockNotificationService = {
      notifications: signal([mockNotif]),
      dismissNotification: vi.fn().mockResolvedValue(undefined),
      dismissAll: vi.fn().mockResolvedValue(undefined),
    };

    mockRoutingService = {
      navigateToParts: vi.fn(),
      hrefForView: vi.fn().mockReturnValue('#/gradings/grading-1'),
      hrefWithParams: vi.fn().mockReturnValue('#/notifications?filter=unread'),
    };

    await TestBed.configureTestingModule({
      imports: [NotificationsListComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: FirebaseStateService, useValue: mockFirebaseService },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: RoutingService, useValue: mockRoutingService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationsListComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render notifications successfully', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.notification-card')).toBeTruthy();
    expect(compiled.querySelector('.notification-card')?.textContent).toContain('Welcome Student!');
  });

  // The dismiss handlers wait for the fold-up animation (~280ms) before
  // committing the change, so give them a little longer than that to settle.
  const waitForCollapse = () => new Promise((r) => setTimeout(r, 350));

  it('should call dismissNotification when close button is clicked', async () => {
    const dismissBtn = fixture.nativeElement.querySelector('.dismiss-btn') as HTMLButtonElement;
    dismissBtn.click();
    await waitForCollapse();
    await fixture.whenStable();

    expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith('id1');
  });

  it('should call dismissAll when Dismiss All is clicked', async () => {
    const dismissAllBtn = fixture.nativeElement.querySelector('.dismiss-all-btn') as HTMLButtonElement;
    dismissAllBtn.click();
    await waitForCollapse();
    await fixture.whenStable();

    expect(mockNotificationService.dismissAll).toHaveBeenCalled();
  });

  it('should render a grading link pointing at the grading view', () => {
    const link = fixture.nativeElement.querySelector('.grading-link') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(mockRoutingService.hrefForView).toHaveBeenCalledWith('gradingView', {
      gradingId: 'grading-1',
    });
    expect(link.getAttribute('href')).toBe('#/gradings/grading-1');
  });

  it('should NOT navigate when the card itself is clicked (only the link navigates)', async () => {
    const card = fixture.nativeElement.querySelector('.notification-card') as HTMLDivElement;
    card.click();
    await fixture.whenStable();

    expect(mockRoutingService.navigateToParts).not.toHaveBeenCalled();
  });

  it('caps the home feed at 3 cards and shows a view-all link when there are more', async () => {
    const many = [1, 2, 3, 4].map((i) => ({ ...mockNotif, docId: `id${i}` }));
    mockNotificationService.notifications.set(many);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('.notification-card').length).toBe(3);
    const viewAll = fixture.nativeElement.querySelector('.view-all-link') as HTMLAnchorElement;
    expect(viewAll).toBeTruthy();
    expect(viewAll.textContent).toContain('View all 4 notifications');
    // The link opens the notifications page filtered to unread.
    expect(mockRoutingService.hrefWithParams).toHaveBeenCalledWith('/notifications?filter=unread');
    expect(viewAll.getAttribute('href')).toBe('#/notifications?filter=unread');
  });

  it('shows no view-all link when there are 3 or fewer notifications', async () => {
    mockNotificationService.notifications.set([
      { ...mockNotif, docId: 'id1' },
      { ...mockNotif, docId: 'id2' },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('.notification-card').length).toBe(2);
    expect(fixture.nativeElement.querySelector('.view-all-link')).toBeFalsy();
  });
});
