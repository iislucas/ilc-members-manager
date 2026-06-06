import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { vi } from 'vitest';
import { NotificationSettingsComponent } from './notification-settings.component';
import { NotificationService } from '../../notification.service';
import { FirebaseStateService } from '../../firebase-state.service';
import { DataManagerService } from '../../data-manager.service';
import { NotificationKind } from '../../../../functions/src/data-model';

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
});
