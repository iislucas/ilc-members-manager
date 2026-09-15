import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { NotificationSettingsComponent } from './notification-settings.component';
import { NotificationService } from '../../notification.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { NotificationKind, EventDigestFrequency } from '../../../../functions/src/data-model/notifications';
import { TransactionalEmailKey } from '../../../../functions/src/data-model/mail';
import { provideNavigationTreeStub } from '../../navigation-tree.testing';

describe('NotificationSettingsComponent', () => {
  let component: NotificationSettingsComponent;
  let fixture: ComponentFixture<NotificationSettingsComponent>;

  // Mocks
  let mockNotificationService: any;
  let mockFirebaseService: any;

  beforeEach(async () => {
    mockNotificationService = {
      localSettings: signal({
        globalPushEnabled: true,
        pushEnabled: {},
        homeEnabled: {},
      }),
      permissionStatus: signal('granted'),
      pushDeviceEnabled: signal(false),
      isPushSupported: false,
      requestPermission: vi.fn().mockResolvedValue('granted'),
      updateLocalSettings: vi.fn(),
      enablePushOnThisDevice: vi.fn().mockResolvedValue(true),
      disablePushOnThisDevice: vi.fn().mockResolvedValue(undefined),
    };

    mockFirebaseService = {
      user: signal({
        email: 'test@example.com',
        member: {
          docId: 'member-123',
          name: 'Test Student',
        },
      }),
      app: {},
    };

    await TestBed.configureTestingModule({
      imports: [NotificationSettingsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNavigationTreeStub(),
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: FirebaseStateService, useValue: mockFirebaseService },
        {
          provide: DataManagerService,
          useValue: { updateMember: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NotificationSettingsComponent);
    component = component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render settings cards and options', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.settings-card')).toBeTruthy();
    expect(compiled.querySelector('h2')?.textContent).toContain('Local Notification Settings');
  });

  it('should toggle all push settings and trigger request permission if default', () => {
    mockNotificationService.permissionStatus.set('default');
    component.setAllPush(true);

    expect(mockNotificationService.updateLocalSettings).toHaveBeenCalled();
    expect(mockNotificationService.requestPermission).toHaveBeenCalled();
  });

  it('should toggle all homepage settings on setAllHome', () => {
    component.setAllHome(false);
    expect(mockNotificationService.updateLocalSettings).toHaveBeenCalled();
  });

  it('should toggle per-kind push settings correctly', () => {
    component.togglePushNotification(NotificationKind.BlogPost, false);

    expect(mockNotificationService.updateLocalSettings).toHaveBeenCalledWith({
      pushEnabled: { [NotificationKind.BlogPost]: false },
    });
  });

  it('should toggle per-kind homepage settings correctly', () => {
    component.toggleHomeNotification(NotificationKind.NewEventPosted, false);

    expect(mockNotificationService.updateLocalSettings).toHaveBeenCalledWith({
      homeEnabled: { [NotificationKind.NewEventPosted]: false },
    });
  });

  it('should display and update upcoming event digest frequency', async () => {
    fixture.detectChanges();
    const dataManager = TestBed.inject(DataManagerService);
    expect(component['eventDigestFrequency']()).toBe(EventDigestFrequency.None);

    const select = fixture.nativeElement.querySelector('#event-digest-frequency') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe(EventDigestFrequency.None);

    await component.setEventDigestFrequency(EventDigestFrequency.Weekly);
    expect(dataManager.updateMember).toHaveBeenCalledWith(
      'member-123',
      expect.objectContaining({
        notificationSettings: expect.objectContaining({
          eventDigestFrequency: EventDigestFrequency.Weekly,
        }),
      }),
      expect.any(Object),
    );
  });

  it('should toggle transactional email preferences', async () => {
    fixture.detectChanges();
    const dataManager = TestBed.inject(DataManagerService);

    expect(component.isEmailKindEnabled(TransactionalEmailKey.OrderConfirmation)).toBe(true);

    await component.toggleEmailKind(TransactionalEmailKey.OrderConfirmation, false);
    expect(dataManager.updateMember).toHaveBeenCalledWith(
      'member-123',
      expect.objectContaining({
        notificationSettings: expect.objectContaining({
          emailEnabled: expect.objectContaining({
            [TransactionalEmailKey.OrderConfirmation]: false,
          }),
        }),
      }),
      expect.any(Object),
    );
  });

  it('should manage global email setting and respect it in isEmailKindEnabled', async () => {
    fixture.detectChanges();
    const dataManager = TestBed.inject(DataManagerService);

    expect(component['globalEmailEnabled']()).toBe(true);
    expect(component.isEmailKindEnabled(TransactionalEmailKey.VodGiftReceived)).toBe(true);

    await component.setGlobalEmail(false);
    expect(dataManager.updateMember).toHaveBeenCalledWith(
      'member-123',
      expect.objectContaining({
        notificationSettings: expect.objectContaining({
          globalEmailEnabled: false,
        }),
      }),
      expect.any(Object),
    );

    // When global email is disabled, all email kinds report disabled
    mockFirebaseService.user.set({
      email: 'test@example.com',
      member: {
        docId: 'member-123',
        name: 'Test Student',
        notificationSettings: {
          globalEmailEnabled: false,
        },
      },
    });
    fixture.detectChanges();
    expect(component['globalEmailEnabled']()).toBe(false);
    expect(component.isEmailKindEnabled(TransactionalEmailKey.VodGiftReceived)).toBe(false);
  });

  it('should toggle VodGiftReceived email preference specifically', async () => {
    fixture.detectChanges();
    const dataManager = TestBed.inject(DataManagerService);

    expect(component.isEmailKindEnabled(TransactionalEmailKey.VodGiftReceived)).toBe(true);

    await component.toggleEmailKind(TransactionalEmailKey.VodGiftReceived, false);
    expect(dataManager.updateMember).toHaveBeenCalledWith(
      'member-123',
      expect.objectContaining({
        notificationSettings: expect.objectContaining({
          emailEnabled: expect.objectContaining({
            [TransactionalEmailKey.VodGiftReceived]: false,
          }),
        }),
      }),
      expect.any(Object),
    );
  });
});

