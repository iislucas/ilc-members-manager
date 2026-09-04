import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateNotificationComponent } from './update-notification.component';
import { AppUpdateService } from '../app-update.service';

describe('UpdateNotificationComponent', () => {
  let component: UpdateNotificationComponent;
  let fixture: ComponentFixture<UpdateNotificationComponent>;
  let mockUpdateService: {
    isUpdateAvailable: ReturnType<typeof signal<boolean>>;
    updateDismissed: ReturnType<typeof signal<boolean>>;
    applyUpdate: ReturnType<typeof vi.fn>;
    dismissPrompt: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockUpdateService = {
      isUpdateAvailable: signal(false),
      updateDismissed: signal(false),
      applyUpdate: vi.fn(),
      dismissPrompt: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [UpdateNotificationComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppUpdateService, useValue: mockUpdateService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UpdateNotificationComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should not render anything when no update is available', () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.update-toast')).toBeNull();
  });

  it('should render toast when update is available and not dismissed', async () => {
    mockUpdateService.isUpdateAvailable.set(true);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.update-toast')).toBeTruthy();
    expect(el.querySelector('.toast-title')?.textContent).toContain('Update Available');
  });

  it('should not render toast when update is dismissed', async () => {
    mockUpdateService.isUpdateAvailable.set(true);
    mockUpdateService.updateDismissed.set(true);
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.update-toast')).toBeNull();
  });

  it('should call applyUpdate when Update Now is clicked', async () => {
    mockUpdateService.isUpdateAvailable.set(true);
    await fixture.whenStable();

    const updateBtn = fixture.nativeElement.querySelector('.update-btn') as HTMLButtonElement;
    updateBtn.click();

    expect(mockUpdateService.applyUpdate).toHaveBeenCalled();
  });

  it('should call dismissPrompt when Later is clicked', async () => {
    mockUpdateService.isUpdateAvailable.set(true);
    await fixture.whenStable();

    const dismissBtn = fixture.nativeElement.querySelector('.dismiss-btn') as HTMLButtonElement;
    dismissBtn.click();

    expect(mockUpdateService.dismissPrompt).toHaveBeenCalled();
  });
});
