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

  it('should call dismissNotification when close button is clicked', async () => {
    const dismissBtn = fixture.nativeElement.querySelector('.dismiss-btn') as HTMLButtonElement;
    dismissBtn.click();
    await fixture.whenStable();

    expect(mockNotificationService.dismissNotification).toHaveBeenCalledWith('id1');
  });

  it('should call dismissAll when Dismiss All is clicked', async () => {
    const dismissAllBtn = fixture.nativeElement.querySelector('.dismiss-all-btn') as HTMLButtonElement;
    dismissAllBtn.click();
    await fixture.whenStable();

    expect(mockNotificationService.dismissAll).toHaveBeenCalled();
  });

  it('should call routingService.navigateToParts when card is clicked', async () => {
    const card = fixture.nativeElement.querySelector('.notification-card') as HTMLDivElement;
    card.click();
    await fixture.whenStable();

    expect(mockRoutingService.navigateToParts).toHaveBeenCalledWith(['gradings', 'grading-1']);
  });

  it('should NOT call routingService.navigateToParts when close button is clicked (stops propagation)', async () => {
    const dismissBtn = fixture.nativeElement.querySelector('.dismiss-btn') as HTMLButtonElement;
    dismissBtn.click();
    await fixture.whenStable();

    expect(mockRoutingService.navigateToParts).not.toHaveBeenCalled();
  });
});
