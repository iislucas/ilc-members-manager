/* download-resource.spec.ts
 *
 * Unit tests for DownloadResourceComponent.
 * Verifies handling of public vs authenticated downloads, permission denials,
 * structured error parsing (missing vs expired instructor/member licenses),
 * and renewal links.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, Component, Input } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DownloadResourceComponent } from './download-resource';
import { FirebaseStateService, LoginStatus } from '../firebase-state.service';
import { DataManagerService } from '../data-manager.service';
import { ROUTING_CONFIG, initPathPatterns, Views } from '../app.config';
import { RoutingService } from '../routing.service';
import { SpinnerComponent } from '../spinner/spinner.component';
import { IconComponent } from '../icons/icon.component';
import { LoginComponent } from '../login/login';

@Component({
  selector: 'app-spinner',
  standalone: true,
  template: '',
})
class MockSpinnerComponent {}

@Component({
  selector: 'app-icon',
  standalone: true,
  template: '',
})
class MockIconComponent {
  @Input() name: any;
}

@Component({
  selector: 'app-login',
  standalone: true,
  template: '',
})
class MockLoginComponent {}

describe('DownloadResourceComponent', () => {
  let component: DownloadResourceComponent;
  let fixture: ComponentFixture<DownloadResourceComponent>;
  let mockFirebaseStateService: any;
  let mockDataManagerService: any;
  let routingService: RoutingService<typeof initPathPatterns>;

  beforeEach(async () => {
    mockFirebaseStateService = {
      loginStatus: signal(LoginStatus.SignedIn),
      user: signal({ email: 'tim@zxdpdx.com' }),
    };

    mockDataManagerService = {
      getResourceDownloadUrl: vi.fn().mockResolvedValue('https://storage.googleapis.com/test-signed-url'),
    };

    await TestBed.configureTestingModule({
      imports: [DownloadResourceComponent, MockSpinnerComponent, MockIconComponent, MockLoginComponent],
      providers: [
        { provide: FirebaseStateService, useValue: mockFirebaseStateService },
        { provide: DataManagerService, useValue: mockDataManagerService },
        { provide: ROUTING_CONFIG, useValue: { validPathPatterns: initPathPatterns } },
      ],
    })
      .overrideComponent(DownloadResourceComponent, {
        remove: { imports: [SpinnerComponent, IconComponent, LoginComponent] },
        add: { imports: [MockSpinnerComponent, MockIconComponent, MockLoginComponent] },
      })
      .compileComponents();

    routingService = TestBed.inject(RoutingService) as never as RoutingService<typeof initPathPatterns>;
    const viewSignals = routingService.signals[Views.DownloadResource];
    viewSignals.pathVars.accessLevel.set('instructors');
    viewSignals.pathVars.fileName.set('Instructor Packet 2026.pdf');

    fixture = TestBed.createComponent(DownloadResourceComponent);
    component = fixture.componentInstance;
  });

  it('should create and compute fullPath', () => {
    expect(component).toBeTruthy();
    expect(component.fullPath()).toBe('resources/instructors/Instructor Packet 2026.pdf');
    expect(component.accessLabel()).toBe('Instructors');
  });

  it('handles missing instructor license error with renewal link', async () => {
    const error = {
      code: 'functions/permission-denied',
      message: 'This resource is for licensed instructors. You do not have an instructor license.',
      details: {
        reason: 'missing',
        tier: 'instructor',
      },
    };
    mockDataManagerService.getResourceDownloadUrl.mockRejectedValueOnce(error);

    await component.startDownload('resources/instructors/Instructor Packet 2026.pdf');

    const state = component.state();
    expect(state.kind).toBe('error');
    if (state.kind === 'error') {
      expect(state.error.title).toBe('Instructors Only');
      expect(state.error.message).toBe('This resource is for licensed instructors. You do not currently have an instructor license.');
      expect(state.error.renewalLabel).toBe('Get Instructor License');
    }
  });

  it('handles expired instructor license error with renewal date', async () => {
    const error = {
      code: 'functions/permission-denied',
      message: 'This resource is for licensed instructors. Your instructor license expired on 2024-05-11.',
      details: {
        reason: 'expired',
        tier: 'instructor',
        expiryDate: '2024-05-11',
      },
    };
    mockDataManagerService.getResourceDownloadUrl.mockRejectedValueOnce(error);

    await component.startDownload('resources/instructors/Instructor Packet 2026.pdf');

    const state = component.state();
    expect(state.kind).toBe('error');
    if (state.kind === 'error') {
      expect(state.error.title).toBe('Instructor License Expired');
      expect(state.error.message).toContain('Your instructor license expired on 2024-05-11.');
      expect(state.error.renewalLabel).toBe('Renew License');
    }
  });

  it('opens signed URL on successful download', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await component.startDownload('resources/instructors/Instructor Packet 2026.pdf');

    expect(mockDataManagerService.getResourceDownloadUrl).toHaveBeenCalledWith(
      'resources/instructors/Instructor Packet 2026.pdf'
    );
    expect(openSpy).toHaveBeenCalledWith('https://storage.googleapis.com/test-signed-url', '_blank');
    expect(component.state()).toEqual({
      kind: 'done',
      fileName: 'Instructor Packet 2026.pdf',
    });
  });
});
