import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppVersionSettingsComponent } from './app-version';
import { AppUpdateService } from '../../app-update.service';

describe('AppVersionSettingsComponent', () => {
  let component: AppVersionSettingsComponent;
  let fixture: ComponentFixture<AppVersionSettingsComponent>;
  let mockUpdateService: {
    currentVersion: ReturnType<typeof signal<string>>;
    isServiceWorkerEnabled: ReturnType<typeof signal<boolean>>;
    lastChecked: ReturnType<typeof signal<Date | null>>;
    isChecking: ReturnType<typeof signal<boolean>>;
    isUpdateAvailable: ReturnType<typeof signal<boolean>>;
    checkError: ReturnType<typeof signal<string | null>>;
    checkForUpdate: ReturnType<typeof vi.fn>;
    applyUpdate: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockUpdateService = {
      currentVersion: signal('0.0.1+2026-08-29T12:00'),
      isServiceWorkerEnabled: signal(true),
      lastChecked: signal<Date | null>(new Date('2026-08-29T12:05:00Z')),
      isChecking: signal(false),
      isUpdateAvailable: signal(false),
      checkError: signal<string | null>(null),
      checkForUpdate: vi.fn().mockResolvedValue(false),
      applyUpdate: vi.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [AppVersionSettingsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppUpdateService, useValue: mockUpdateService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AppVersionSettingsComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create and render version details', () => {
    expect(component).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.version-value')?.textContent).toContain('0.0.1+2026-08-29T12:00');
    expect(el.querySelector('.active-badge')?.textContent).toContain('Enabled & Active');
  });

  it('should trigger checkForUpdate on Check for Updates button click', async () => {
    const checkBtn = fixture.nativeElement.querySelector('.check-btn') as HTMLButtonElement;
    checkBtn.click();
    expect(mockUpdateService.checkForUpdate).toHaveBeenCalled();
  });

  it('should show update ready banner when update is available', async () => {
    mockUpdateService.isUpdateAvailable.set(true);
    await fixture.whenStable();

    const banner = fixture.nativeElement.querySelector('.update-ready-banner');
    expect(banner).toBeTruthy();

    const updateNowBtn = fixture.nativeElement.querySelector('.update-now-btn') as HTMLButtonElement;
    updateNowBtn.click();
    expect(mockUpdateService.applyUpdate).toHaveBeenCalled();
  });
});
