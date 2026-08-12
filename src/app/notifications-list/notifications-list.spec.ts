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
    localStorage.removeItem('ilc_home_notifications_folded');
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
      syncError: signal<string | null>(null),
      dismissSyncError: vi.fn(),
      dismissNotification: vi.fn().mockResolvedValue(undefined),
      dismissAll: vi.fn().mockResolvedValue(undefined),
    };

    mockRoutingService = {
      navigateToParts: vi.fn(),
      hrefForView: vi.fn().mockImplementation((view: string, vars?: any) => {
        if (view === 'gradingView') return `#/gradings/${vars?.gradingId}`;
        if (view === 'notificationSettings') return '#/settings/notifications';
        return '#/';
      }),
      hrefWithParams: vi.fn().mockImplementation((url: string) => `#${url}`),
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

  afterEach(() => {
    localStorage.removeItem('ilc_home_notifications_folded');
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render Notifications title and badge with correct links', () => {
    const titleLink = fixture.nativeElement.querySelector('.section-title-link') as HTMLAnchorElement;
    expect(titleLink).toBeTruthy();
    expect(titleLink.textContent?.trim()).toBe('Notifications');
    expect(titleLink.getAttribute('href')).toBe('#/notifications?filter=all');

    const badgeLink = fixture.nativeElement.querySelector('.badge') as HTMLAnchorElement;
    expect(badgeLink).toBeTruthy();
    expect(badgeLink.textContent?.trim()).toBe('1');
    expect(badgeLink.getAttribute('href')).toBe('#/notifications?filter=unread');
  });

  it('should toggle fold/unfold state and persist to localStorage', () => {
    expect(component.isFolded()).toBe(false);
    expect(localStorage.getItem('ilc_home_notifications_folded')).toBeNull();
    const body = fixture.nativeElement.querySelector('.notifications-body') as HTMLElement;
    expect(body.classList.contains('folded')).toBe(false);

    const foldBtn = fixture.nativeElement.querySelector('.fold-toggle-btn') as HTMLButtonElement;
    foldBtn.click();
    fixture.detectChanges();

    expect(component.isFolded()).toBe(true);
    expect(body.classList.contains('folded')).toBe(true);
    expect(localStorage.getItem('ilc_home_notifications_folded')).toBe('true');

    foldBtn.click();
    fixture.detectChanges();

    expect(component.isFolded()).toBe(false);
    expect(body.classList.contains('folded')).toBe(false);
    expect(localStorage.getItem('ilc_home_notifications_folded')).toBe('false');
  });

  it('should restore folded state from localStorage on init', async () => {
    localStorage.setItem('ilc_home_notifications_folded', 'true');
    const customFixture = TestBed.createComponent(NotificationsListComponent);
    const customComp = customFixture.componentInstance;
    await customFixture.whenStable();

    expect(customComp.isFolded()).toBe(true);
  });

  it('should open 3-dots menu with Dismiss All, All Notifications, Unread Notifications, and Settings links', () => {
    const moreBtn = fixture.nativeElement.querySelector('.more-btn') as HTMLButtonElement;
    expect(moreBtn).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.notifications-menu')).toBeFalsy();

    moreBtn.click();
    fixture.detectChanges();

    const menu = fixture.nativeElement.querySelector('.notifications-menu') as HTMLElement;
    expect(menu).toBeTruthy();

    const dismissAllBtn = menu.querySelector('.dismiss-all-btn') as HTMLButtonElement;
    expect(dismissAllBtn).toBeTruthy();
    expect(dismissAllBtn.textContent).toContain('Dismiss all');

    const menuLinks = menu.querySelectorAll('a.menu-item');
    expect(menuLinks.length).toBe(3);
    expect(menuLinks[0].textContent).toContain('All notifications');
    expect(menuLinks[0].getAttribute('href')).toBe('#/notifications?filter=all');
    expect(menuLinks[1].textContent).toContain('Unread notifications');
    expect(menuLinks[1].getAttribute('href')).toBe('#/notifications?filter=unread');
    expect(menuLinks[2].textContent).toContain('Notification settings');
    expect(menuLinks[2].getAttribute('href')).toBe('#/settings/notifications');
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

  it('should call dismissAll when Dismiss All in menu is clicked', async () => {
    component.menuOpen.set(true);
    fixture.detectChanges();

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

  it('renders sync error banner and calls dismissSyncError when clicked', async () => {
    mockNotificationService.syncError.set('The query requires an index: https://console.firebase.google.com/...');
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 20));
    fixture.detectChanges();
    await fixture.whenStable();

    const banner = fixture.nativeElement.querySelector('.notification-error-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('The query requires an index');

    const dismissBtn = banner.querySelector('.dismiss-error-btn') as HTMLButtonElement;
    dismissBtn.click();
    expect(mockNotificationService.dismissSyncError).toHaveBeenCalled();
  });
});
